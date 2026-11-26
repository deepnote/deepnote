import assert from 'node:assert'
import { setImmediate } from 'node:timers/promises'
import {
  type Data,
  DataType,
  DateUnit,
  type Decimal,
  type Field,
  type FixedSizeList,
  Int64,
  type LargeList,
  List,
  type Map_,
  type Schema,
  StructRow,
  type Timestamp,
  TimeUnit,
  Vector,
} from 'apache-arrow'
import { InvalidArrowFileError, UnservablePageError, UnsupportedArrowTypeError } from './errors'

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
/** One value per column, in column order. */
export type DataframeRow = JsonValue[]

export const DATAFRAME_COLUMN_TYPES = [
  'null',
  'integer',
  'int64',
  'float',
  'boolean',
  'string',
  'binary',
  'decimal',
  'date',
  'timestamp',
  'time',
  'duration',
  'list',
  'struct',
  'map',
] as const

export type DataframeColumnType = (typeof DATAFRAME_COLUMN_TYPES)[number]

export interface DataframeColumn {
  name: string
  type: DataframeColumnType
  timezone: string | null
}

export interface ArrowPageColumn {
  field: Field
  vector: Vector
}

export interface EncodeRowsHooks {
  chargeJsonBytes?: (bytes: number) => void
  chargeValues?: (count: number) => void
}

type Scalar = string | number | boolean | null

const EXTENSION_NAME_KEY = 'ARROW:extension:name'
const UUID_EXTENSION = 'arrow.uuid'
const UUID_BYTES = 16
const DECIMAL_BIT_WIDTHS = [32, 64, 128, 256]
// toISOString writes the years outside 0 to 9999 as ±YYYYYY.
const FIRST_MILLISECOND = Date.parse('0000-01-01T00:00:00Z')
const END_MILLISECOND = Date.parse('+010000-01-01T00:00:00Z')
const NANOSECONDS_PER_UNIT = {
  [TimeUnit.SECOND]: 1_000_000_000n,
  [TimeUnit.MILLISECOND]: 1_000_000n,
  [TimeUnit.MICROSECOND]: 1_000n,
  [TimeUnit.NANOSECOND]: 1n,
} as const

function isText(type: DataType): boolean {
  return DataType.isUtf8(type) || DataType.isLargeUtf8(type) || DataType.isUtf8View(type)
}

function isBinary(type: DataType): boolean {
  return (
    DataType.isBinary(type) ||
    DataType.isLargeBinary(type) ||
    DataType.isBinaryView(type) ||
    DataType.isFixedSizeBinary(type)
  )
}

function isList(type: DataType): type is List | LargeList | FixedSizeList {
  return DataType.isList(type) || DataType.isLargeList(type) || DataType.isFixedSizeList(type)
}

/** apache-arrow decodes any width a forged frame declares, and encodeDecimal's BigInt arithmetic is quadratic in it. */
function isDecimal(type: DataType): type is Decimal {
  return DataType.isDecimal(type) && DECIMAL_BIT_WIDTHS.includes(type.bitWidth)
}

/** apache-arrow decodes any unit a forged frame declares. */
function isTimestamp(type: DataType): type is Timestamp {
  return DataType.isTimestamp(type) && type.unit in NANOSECONDS_PER_UNIT
}

function isUuid(field: Field, type: DataType): boolean {
  return (
    field.metadata.get(EXTENSION_NAME_KEY) === UUID_EXTENSION &&
    DataType.isFixedSizeBinary(type) &&
    type.byteWidth === UUID_BYTES
  )
}

function unwrapDictionaryType(type: DataType): DataType {
  return DataType.isDictionary(type) ? type.dictionary : type
}

function columnType(field: Field): DataframeColumnType {
  // apache-arrow types indices as at most 32 bits, yet decodes the 64-bit ones pyarrow can write as bigints that its
  // value getters cannot index with.
  if (DataType.isDictionary(field.type) && field.type.indices.bitWidth > 32) {
    throw UnsupportedArrowTypeError.unsupportedColumnType(field.type)
  }
  const type = unwrapDictionaryType(field.type)
  if (DataType.isNull(type)) {
    return 'null'
  }
  if (DataType.isInt(type)) {
    return type.bitWidth === 64 ? 'int64' : 'integer'
  }
  if (DataType.isFloat(type)) {
    return 'float'
  }
  if (DataType.isBool(type)) {
    return 'boolean'
  }
  if (isText(type) || isUuid(field, type)) {
    return 'string'
  }
  if (isBinary(type)) {
    return 'binary'
  }
  if (isDecimal(type)) {
    return 'decimal'
  }
  if (DataType.isDate(type)) {
    return 'date'
  }
  if (isTimestamp(type)) {
    return 'timestamp'
  }
  if (DataType.isTime(type) && type.unit in NANOSECONDS_PER_UNIT) {
    return 'time'
  }
  if (DataType.isDuration(type) && type.unit in NANOSECONDS_PER_UNIT) {
    return 'duration'
  }
  if (isList(type)) {
    return 'list'
  }
  if (DataType.isStruct(type)) {
    if (new Set(type.children.map(({ name }) => name)).size < type.children.length) {
      throw UnsupportedArrowTypeError.duplicateStructField(type)
    }
    return 'struct'
  }
  if (DataType.isMap(type)) {
    return 'map'
  }
  throw UnsupportedArrowTypeError.unsupportedColumnType(type)
}

function describeField(field: Field): DataframeColumnType {
  const type = columnType(field)
  // apache-arrow types the children as an array but leaves them null on types without any.
  for (const child of field.type.children ?? []) {
    describeField(child)
  }
  return type
}

/**
 * Throws UnsupportedArrowTypeError for a column, or a nested field, of a type encodeRows cannot encode, or a struct
 * with two fields of the same name, of which a JSON object keeps only the last.
 */
export function describeColumns(schema: Schema): DataframeColumn[] {
  return schema.fields.map(field => {
    const type = unwrapDictionaryType(field.type)
    return {
      name: field.name,
      type: describeField(field),
      timezone: DataType.isTimestamp(type) && type.timezone ? type.timezone : null,
    }
  })
}

function unreadableError(error: unknown): InvalidArrowFileError {
  return InvalidArrowFileError.unreadableValue(error instanceof Error ? error.message : String(error), error)
}

/** apache-arrow does not check a frame's buffers against its metadata, so a getter that throws means a forged frame. */
function readValue(vector: Vector, index: number): unknown {
  try {
    return vector.get(index)
  } catch (error) {
    throw unreadableError(error)
  }
}

function* readEntries<T>(entries: Iterable<T>): Generator<T> {
  const iterator = entries[Symbol.iterator]()
  for (;;) {
    let next: IteratorResult<T>
    try {
      next = iterator.next()
    } catch (error) {
      throw unreadableError(error)
    }
    if (next.done) {
      return
    }
    yield next.value
  }
}

function leaf(value: Scalar, hooks: EncodeRowsHooks): Scalar {
  // JSON.stringify writes a control character in six bytes, so a string's length and quotes are charged before it runs.
  const certainBytes = typeof value === 'string' ? value.length + 2 : 0
  if (certainBytes > 0) {
    hooks.chargeJsonBytes?.(certainBytes)
  }
  hooks.chargeJsonBytes?.(Buffer.byteLength(JSON.stringify(value)) - certainBytes)
  return value
}

function jsonArrayOverheadBytes(count: number): number {
  return Math.max(count + 1, 2)
}

function keyJsonBytes(name: string): number {
  return Buffer.byteLength(JSON.stringify(name)) + 1
}

function toDate(value: unknown): Date {
  assert(typeof value === 'number', 'a date or timestamp is read as a number of milliseconds')
  if (Number.isNaN(value) || value < FIRST_MILLISECOND || value >= END_MILLISECOND) {
    throw UnservablePageError.dateOutOfRange()
  }
  return new Date(Math.floor(value))
}

function pad(value: number, digits: number): string {
  return String(value).padStart(digits, '0')
}

function formatTime(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor(milliseconds / 60_000) % 60
  const seconds = Math.floor(milliseconds / 1000) % 60

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(milliseconds % 1000, 3)}`
}

function formatUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function encodeScalar(value: unknown, field: Field, type: DataType): Scalar {
  if (DataType.isBool(type)) {
    assert(typeof value === 'boolean', 'apache-arrow reads a boolean from a Bool column')
    return value
  }
  if (DataType.isInt(type) || DataType.isFloat(type)) {
    assert(typeof value === 'number' || typeof value === 'bigint', 'apache-arrow reads a number from a number column')
    if (DataType.isInt(type) && type.bitWidth === 64) {
      return value.toString()
    }
    return Number.isFinite(Number(value)) ? Number(value) : null
  }
  if (isText(type)) {
    assert(typeof value === 'string', 'apache-arrow reads a string from a string column')
    return value
  }
  if (isUuid(field, type)) {
    assert(value instanceof Uint8Array, 'apache-arrow reads a Uint8Array from a binary column')
    return formatUuid(Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex'))
  }
  if (DataType.isDate(type)) {
    const milliseconds = typeof value === 'bigint' ? Number(value) : value
    return toDate(milliseconds).toISOString().slice(0, 10)
  }
  if (isTimestamp(type)) {
    assert(typeof value === 'bigint', 'withReadableTypes has a timestamp read as its Int64')
    const nanoseconds = value * NANOSECONDS_PER_UNIT[type.unit]
    const milliseconds = nanoseconds / 1_000_000n - (nanoseconds % 1_000_000n < 0n ? 1n : 0n)
    const iso = toDate(Number(milliseconds)).toISOString()
    return type.timezone ? iso : iso.slice(0, -1)
  }
  if (DataType.isTime(type)) {
    assert(typeof value === 'number' || typeof value === 'bigint', 'apache-arrow reads a number from a Time column')
    return formatTime(Number((BigInt(value) * NANOSECONDS_PER_UNIT[type.unit]) / 1_000_000n))
  }
  if (DataType.isDuration(type)) {
    assert(typeof value === 'bigint', 'apache-arrow reads a bigint from a Duration column')
    return Number(value) / Number(NANOSECONDS_PER_UNIT[TimeUnit.SECOND] / NANOSECONDS_PER_UNIT[type.unit])
  }
  throw UnsupportedArrowTypeError.unsupportedColumnType(type)
}

/** A forged scale can make the text gigabytes long, so it is charged before it is built. */
function encodeDecimal(value: unknown, type: Decimal, hooks: EncodeRowsHooks): string {
  assert(value instanceof Uint32Array, 'apache-arrow reads a decimal as a Uint32Array of little-endian words')
  const unscaled = BigInt.asIntN(
    type.bitWidth,
    value.reduceRight((sum, word) => (sum << 32n) | BigInt(word), 0n)
  )
  const sign = unscaled < 0n ? '-' : ''
  const digits = (unscaled < 0n ? -unscaled : unscaled).toString()
  const { scale } = type
  if (scale <= 0) {
    const zeros = unscaled === 0n ? 0 : -scale
    hooks.chargeJsonBytes?.(sign.length + digits.length + zeros + 2)
    return `${sign}${digits}${'0'.repeat(zeros)}`
  }
  hooks.chargeJsonBytes?.(sign.length + Math.max(digits.length - scale, 1) + 1 + scale + 2)
  const padded = digits.padStart(scale + 1, '0')

  return `${sign}${padded.slice(0, -scale)}.${padded.slice(-scale)}`
}

function encodeBinary(value: unknown, hooks: EncodeRowsHooks): string {
  assert(value instanceof Uint8Array, 'apache-arrow reads a Uint8Array from a binary column')
  hooks.chargeJsonBytes?.(4 * Math.ceil(value.byteLength / 3) + 2)
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64')
}

function encodeList(value: unknown, itemField: Field, hooks: EncodeRowsHooks): JsonValue[] {
  assert(value instanceof Vector, 'apache-arrow reads a list as a Vector')
  hooks.chargeJsonBytes?.(jsonArrayOverheadBytes(value.length))
  hooks.chargeValues?.(value.length)

  return Array.from({ length: value.length }, (_, index) => encodeValue(readValue(value, index), itemField, hooks))
}

function encodeStruct(value: unknown, fields: readonly Field[], hooks: EncodeRowsHooks): JsonValue {
  assert(value instanceof StructRow, 'apache-arrow reads a struct as a StructRow')
  hooks.chargeJsonBytes?.(
    fields.reduce((bytes, { name }) => bytes + keyJsonBytes(name), jsonArrayOverheadBytes(fields.length))
  )
  hooks.chargeValues?.(fields.length)
  const entries: [string, JsonValue][] = []
  for (const [, child] of readEntries(value)) {
    const field = fields[entries.length]
    assert(field, 'apache-arrow reads one entry for each field of a struct')
    entries.push([field.name, encodeValue(child, field, hooks)])
  }
  return Object.fromEntries(entries)
}

function encodeMap(value: unknown, type: Map_, hooks: EncodeRowsHooks): JsonValue[] {
  assert(value instanceof Vector, 'withReadableTypes has the map read as the list of its entries')
  const [keyField, valueField] = type.children.flatMap(entries => entries.type.children)
  assert(keyField && valueField, 'a map has a key field and a value field')
  const [keys, values] = [value.getChildAt(0), value.getChildAt(1)]
  assert(keys && values, 'a map entry has a key and a value')
  hooks.chargeJsonBytes?.(jsonArrayOverheadBytes(value.length))
  hooks.chargeValues?.(2 * value.length)

  return Array.from({ length: value.length }, (_, index) => {
    hooks.chargeJsonBytes?.(jsonArrayOverheadBytes(2))
    const key = encodeValue(readValue(keys, index), keyField, hooks)
    return [key, encodeValue(readValue(values, index), valueField, hooks)]
  })
}

/**
 * apache-arrow reads a map as a MapRow, which allocates a cache as long as its keys, or as their dictionary, before
 * the map can be charged; Arrow lays a map out as a list of its entries. It reads a timestamp or a Date64 as a double
 * of milliseconds, which rounds a finer timestamp up far from 1970 and throws beyond 2^53.
 */
function readableType(type: DataType): DataType {
  if (DataType.isMap(type)) {
    return new List(type.children[0])
  }
  const isInt64Time = DataType.isTimestamp(type) || (DataType.isDate(type) && type.unit === DateUnit.MILLISECOND)
  return isInt64Time ? new Int64() : type
}

function needsReadableTypes(type: DataType): boolean {
  const unwrapped = unwrapDictionaryType(type)
  return (
    readableType(unwrapped) !== unwrapped || (unwrapped.children ?? []).some(child => needsReadableTypes(child.type))
  )
}

function withReadableTypes(data: Data): Data {
  // A copy would lose the cache apache-arrow keeps of each dictionary's values.
  if (!needsReadableTypes(data.type)) {
    return data
  }
  // clone keeps a null count apache-arrow has not counted yet, so a forged null bitmap throws in readValue, not here.
  const copy = data.clone(
    readableType(data.type),
    data.offset,
    data.length,
    undefined,
    undefined,
    data.children.map(withReadableTypes)
  )
  copy.dictionary = data.dictionary && new Vector(data.dictionary.data.map(withReadableTypes))
  return copy
}

function encodeValue(value: unknown, field: Field, hooks: EncodeRowsHooks): JsonValue {
  const type = unwrapDictionaryType(field.type)
  if (value === null || value === undefined) {
    return leaf(null, hooks)
  }
  if (isList(type)) {
    return encodeList(value, type.valueField, hooks)
  }
  if (DataType.isStruct(type)) {
    return encodeStruct(value, type.children, hooks)
  }
  if (DataType.isMap(type)) {
    return encodeMap(value, type, hooks)
  }
  if (isDecimal(type)) {
    return encodeDecimal(value, type, hooks)
  }
  if (isBinary(type) && !isUuid(field, type)) {
    return encodeBinary(value, hooks)
  }
  return leaf(encodeScalar(value, field, type), hooks)
}

function rowsPerEventLoopYield(columns: readonly ArrowPageColumn[]): number {
  const types = columns.map(({ field }) => unwrapDictionaryType(field.type))
  if (columns.length > 200 || types.some(type => isList(type) || DataType.isStruct(type) || DataType.isMap(type))) {
    return 20
  }
  return types.some(type => isText(type) || isBinary(type)) ? 50 : 100
}

/**
 * Encodes the rows of `columns` as JSON values, letting the event loop turn as it goes. Expects `columns` that
 * describeColumns accepted, each holding `rowCount` rows.
 *
 * The hooks charge the caller's budget before each allocation they pay for: `chargeJsonBytes` with the UTF-8 bytes of
 * the rows' JSON, and `chargeValues` with one value for each cell, list item, struct field, map key and map value. A
 * hook refuses the page by throwing one of this package's errors, normally an UnservablePageError. Its error reaches
 * the caller unchanged, unless it is an InvalidArrowFileError thrown while a cell is encoded, which arrives as the
 * `cause` of an `unreadable_row` error. An error that is not a DataframePageError is the caller's to handle as an
 * unknown error.
 */
export async function encodeRows(
  columns: readonly ArrowPageColumn[],
  rowCount: number,
  hooks: EncodeRowsHooks = {}
): Promise<DataframeRow[]> {
  const rowsPerYield = rowsPerEventLoopYield(columns)
  const readableColumns = columns.map(({ field, vector }) => ({
    field,
    vector: new Vector(vector.data.map(withReadableTypes)),
  }))
  hooks.chargeValues?.(columns.length * rowCount)
  hooks.chargeJsonBytes?.(jsonArrayOverheadBytes(rowCount))

  const rows: DataframeRow[] = []
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    hooks.chargeJsonBytes?.(jsonArrayOverheadBytes(columns.length))
    try {
      rows.push(readableColumns.map(({ field, vector }) => encodeValue(readValue(vector, rowIndex), field, hooks)))
    } catch (error) {
      if (error instanceof InvalidArrowFileError) {
        throw InvalidArrowFileError.unreadableRow(rowIndex, error.message, error)
      }
      throw error
    }
    if ((rowIndex + 1) % rowsPerYield === 0) {
      await setImmediate()
    }
  }
  return rows
}
