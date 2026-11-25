import {
  type Data,
  type DataType,
  DateMillisecond,
  Decimal,
  Dictionary,
  Field,
  FixedSizeBinary,
  Int8,
  Int32,
  LargeUtf8,
  List,
  Map_,
  makeData,
  makeVector,
  Struct,
} from 'apache-arrow'

export function uuidField(name: string, byteWidth = 16) {
  return new Field(
    name,
    new FixedSizeBinary(byteWidth),
    true,
    new Map([
      ['ARROW:extension:name', 'arrow.uuid'],
      ['ARROW:extension:metadata', ''],
    ])
  )
}

export function uuidBytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text.replaceAll('-', ''), 'hex'))
}

export function mapType<K extends DataType, V extends DataType>(key: K, value: V) {
  return new Map_<K, V>(
    new Field('entries', new Struct([new Field('key', key, false), new Field('value', value)]), false)
  )
}

export function decimalVector(bitWidth: number, unscaled: bigint[], scale: number, nullBitmap?: Uint8Array) {
  const wordCount = bitWidth / 32
  const words = new Uint32Array(wordCount * unscaled.length)
  unscaled.forEach((value, valueIndex) => {
    let rest = BigInt.asUintN(bitWidth, value)
    for (let word = 0; word < wordCount; word++) {
      words[valueIndex * wordCount + word] = Number(rest & 0xffffffffn)
      rest >>= 32n
    }
  })
  return makeVector(makeData({ type: new Decimal(scale, 38, bitWidth), data: words, nullBitmap }))
}

export function dateData(...milliseconds: bigint[]) {
  return makeData({ type: new DateMillisecond(), data: BigInt64Array.from(milliseconds) })
}

/** apache-arrow throws reading a string whose offsets pass 2^53. */
export function largeUtf8Data(...valueOffsets: bigint[]) {
  return makeData({
    type: new LargeUtf8(),
    length: valueOffsets.length - 1,
    nullCount: 0,
    valueOffsets: BigInt64Array.from(valueOffsets),
    data: Buffer.from('x'.repeat(100)),
  })
}

/**
 * encodeRows always throws InvalidArrowFileError when it reaches the value after `stringsBefore`: apache-arrow cannot
 * convert its end offset to a number.
 */
export function invalidArrowFileErrorTrap(...stringsBefore: string[]) {
  let end = 0n
  const ends = stringsBefore.map(text => {
    end += BigInt(Buffer.byteLength(text))
    return end
  })
  return makeData({
    type: new LargeUtf8(),
    length: stringsBefore.length + 1,
    nullCount: 0,
    valueOffsets: BigInt64Array.of(0n, ...ends, 2n ** 60n),
    data: Buffer.from(stringsBefore.join('')),
  })
}

export function listOf(child: Data) {
  return makeVector(
    makeData({
      type: new List(new Field('item', child.type)),
      length: 1,
      nullCount: 0,
      valueOffsets: Int32Array.of(0, child.length),
      child,
    })
  )
}

export function structOf(child: Data) {
  return makeVector(makeData({ type: new Struct([new Field('d', child.type)]), length: 1, children: [child] }))
}

export function mapOf(values: Data) {
  return makeVector(mapWithOffsets(Int32Array.of(0, 1), int32Data(1), values))
}

export function int32Data(value: number) {
  return makeData({ type: new Int32(), data: Int32Array.of(value) })
}

export function mapWithOffsets(valueOffsets: Int32Array, keys: Data = int32Data(1), values: Data = int32Data(2)) {
  const entries = new Struct([new Field('key', keys.type, false), new Field('value', values.type)])
  return makeData({
    type: new Map_(new Field('entries', entries, false)),
    length: 1,
    nullCount: 0,
    valueOffsets,
    child: makeData({ type: entries, length: 1, children: [keys, values] }),
  })
}

/**
 * apache-arrow's MapRow constructor allocates a key cache as long as the keys' dictionary, and no array holds 2^32
 * elements, so building a MapRow over this map throws.
 */
export function emptyMapOfHugeDictionaryKeys() {
  const dictionary = makeVector(makeData({ type: new Int8(), length: 2 ** 32, data: new Int8Array(1) }))
  return mapWithOffsets(
    Int32Array.of(0, 0),
    makeData({ type: new Dictionary(new Int8(), new Int32()), length: 1, data: Int32Array.of(0), dictionary })
  )
}
