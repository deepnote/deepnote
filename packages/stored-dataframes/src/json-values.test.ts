// cspell:ignore AQID AQIDBA
import {
  Binary,
  BinaryView,
  Bool,
  type Data,
  type DataType,
  DateDay,
  DateMillisecond,
  Decimal,
  Dictionary,
  Duration,
  DurationMicrosecond,
  DurationMillisecond,
  DurationNanosecond,
  DurationSecond,
  Field,
  FixedSizeBinary,
  FixedSizeList,
  Float16,
  Float32,
  Float64,
  Int8,
  Int32,
  Int64,
  IntervalYearMonth,
  LargeBinary,
  LargeList,
  LargeUtf8,
  List,
  makeData,
  makeVector,
  Null,
  Schema,
  Struct,
  Time,
  TimeMicrosecond,
  TimeMillisecond,
  TimeNanosecond,
  TimeSecond,
  Timestamp,
  TimestampMicrosecond,
  TimestampMillisecond,
  TimestampNanosecond,
  TimestampSecond,
  type TimeUnit,
  Uint32,
  Uint64,
  Utf8,
  Utf8View,
  type Vector,
  vectorFromArray,
} from 'apache-arrow'
import { describe, expect, it, vi } from 'vitest'
import { InvalidArrowFileError, UnservablePageError, UnsupportedArrowTypeError } from './errors'
import {
  type ArrowPageColumn,
  type DataframeColumnType,
  describeColumns,
  type EncodeRowsHooks,
  encodeRows,
  type JsonValue,
} from './json-values'
import {
  dateData,
  decimalVector,
  emptyMapOfHugeDictionaryKeys,
  int32Data,
  invalidArrowFileErrorTrap,
  largeUtf8Data,
  listOf,
  mapOf,
  mapType,
  mapWithOffsets,
  structOf,
  uuidBytes,
  uuidField,
} from './json-values.fixtures'

async function countEventLoopTurnsDuring(run: () => Promise<unknown>): Promise<number> {
  let turns = 0
  let settled = false
  const countTurn = () => {
    if (settled) {
      return
    }
    turns += 1
    setImmediate(countTurn)
  }
  setImmediate(countTurn)
  try {
    await run()
  } finally {
    settled = true
  }
  return turns
}

async function encodeColumn(vector: Vector, field = new Field('value', vector.type)): Promise<JsonValue[]> {
  return (await encodeRows([{ field, vector }], vector.length)).flat()
}

async function chargeAll(columns: ArrowPageColumn[], rowCount: number) {
  let json = 0
  let values = 0
  const rows = await encodeRows(columns, rowCount, {
    chargeJsonBytes: bytes => {
      json += bytes
    },
    chargeValues: count => {
      values += count
    },
  })
  return { rows, json, values }
}

describe('describeColumns', () => {
  it.each<[DataType, DataframeColumnType, string | null]>([
    [new Null(), 'null', null],
    [new Uint32(), 'integer', null],
    [new Int64(), 'int64', null],
    [new Uint64(), 'int64', null],
    [new Float32(), 'float', null],
    [new Float64(), 'float', null],
    [new Bool(), 'boolean', null],
    [new Utf8(), 'string', null],
    [new LargeUtf8(), 'string', null],
    [new Utf8View(), 'string', null],
    [new Binary(), 'binary', null],
    [new LargeBinary(), 'binary', null],
    [new BinaryView(), 'binary', null],
    [new Decimal(2, 5, 32), 'decimal', null],
    [new DateDay(), 'date', null],
    [new DateMillisecond(), 'date', null],
    [new TimeSecond(), 'time', null],
    [new TimeNanosecond(), 'time', null],
    [new TimestampSecond(), 'timestamp', null],
    [new TimestampMillisecond('Europe/Prague'), 'timestamp', 'Europe/Prague'],
    [new DurationMillisecond(), 'duration', null],
    [new List(new Field('item', new Int64())), 'list', null],
    [new LargeList(new Field('item', new Int64())), 'list', null],
    [new FixedSizeList(2, new Field('item', new Int64())), 'list', null],
    [new Struct([new Field('a', new Int64())]), 'struct', null],
    [mapType(new Int32(), new Utf8()), 'map', null],
    [new Dictionary(new TimestampSecond('UTC'), new Int8()), 'timestamp', 'UTC'],
    [new Dictionary(new Utf8(), new Int32()), 'string', null],
  ])('describes %s as %s with time zone %s', (type, expected, timezone) => {
    expect(describeColumns(new Schema([new Field('c', type)]))).toEqual([{ name: 'c', type: expected, timezone }])
  })

  it('describes a binary column as a string only when its field is a 16-byte arrow.uuid', () => {
    const otherExtension = new Field('other', new FixedSizeBinary(16), true, new Map([['ARROW:extension:name', 'x.y']]))
    const fields = [
      uuidField('uid'),
      otherExtension,
      new Field('plain', new FixedSizeBinary(16)),
      uuidField('short', 4),
    ]

    expect(describeColumns(new Schema(fields))).toEqual([
      { name: 'uid', type: 'string', timezone: null },
      { name: 'other', type: 'binary', timezone: null },
      { name: 'plain', type: 'binary', timezone: null },
      { name: 'short', type: 'binary', timezone: null },
    ])
  })

  it('describes an extension type other than arrow.uuid as its storage type', () => {
    const field = new Field('period', new Int64(), true, new Map([['ARROW:extension:name', 'pandas.period']]))

    expect(describeColumns(new Schema([field]))).toEqual([{ name: 'period', type: 'int64', timezone: null }])
  })

  it.each([96, 512])('refuses a decimal of %i bits', async bitWidth => {
    const schema = new Schema([new Field('d', new Decimal(2, 38, bitWidth))])

    expect(() => describeColumns(schema)).toThrow(UnsupportedArrowTypeError)
    await expect(encodeColumn(decimalVector(bitWidth, [1n], 2))).rejects.toThrow(UnsupportedArrowTypeError)
  })

  it('refuses a timestamp of a unit Arrow does not define', async () => {
    const type = new Timestamp(7 as TimeUnit)
    const vector = makeVector(makeData({ type, data: BigInt64Array.of(1n) }))

    expect(() => describeColumns(new Schema([new Field('t', type)]))).toThrow(UnsupportedArrowTypeError)
    await expect(encodeColumn(vector)).rejects.toThrow(UnsupportedArrowTypeError)
  })

  it.each<[string, DataType]>([
    ['time', new Time(7 as TimeUnit, 32)],
    ['duration', new Duration(7 as TimeUnit)],
  ])('refuses a %s of a unit Arrow does not define', (_, type) => {
    expect(() => describeColumns(new Schema([new Field('t', type)]))).toThrow(UnsupportedArrowTypeError)
  })

  it.each<[string, DataType]>([
    ['a column', new IntervalYearMonth()],
    ['an item of a list', new List(new Field('item', new IntervalYearMonth()))],
    ['the value of a map', mapType(new Int32(), new IntervalYearMonth())],
  ])('refuses an interval in %s', (_, type) => {
    expect(() => describeColumns(new Schema([new Field('c', type)]))).toThrow(UnsupportedArrowTypeError)
    expect(() => describeColumns(new Schema([new Field('c', type)]))).toThrow(
      expect.objectContaining({
        reason: 'unsupported_column_type',
        message: expect.stringMatching(/unsupported column type/),
      })
    )
  })

  it('refuses a struct with two fields of the same name, at any depth', () => {
    const type = new List(new Field('item', new Struct([new Field('x', new Int32()), new Field('x', new Utf8())])))

    expect(() => describeColumns(new Schema([new Field('c', type)]))).toThrow(UnsupportedArrowTypeError)
    expect(() => describeColumns(new Schema([new Field('c', type)]))).toThrow(/two fields of the same name/)
  })

  it('refuses a dictionary with 64-bit indices, which apache-arrow reads as bigints it cannot index with', () => {
    // @ts-expect-error apache-arrow types indices as at most 32 bits, yet its IPC reader decodes 64-bit ones.
    const type = new Dictionary(new Utf8(), new Int64())
    const nested = new Schema([new Field('c', new List(new Field('item', type)))])

    expect(() => describeColumns(new Schema([new Field('c', type)]))).toThrow(UnsupportedArrowTypeError)
    expect(() => describeColumns(nested)).toThrow(UnsupportedArrowTypeError)
  })
})

describe('encodeRows', () => {
  it('writes one array of values per row, in column order', async () => {
    const columns = [
      { field: new Field('a', new Int32()), vector: vectorFromArray([1, 2], new Int32()) },
      { field: new Field('b', new Utf8()), vector: vectorFromArray(['x', null], new Utf8()) },
    ]

    expect(await encodeRows(columns, 2)).toEqual([
      [1, 'x'],
      [2, null],
    ])
  })

  it('reads a column made of two chunks as one', async () => {
    const vector = vectorFromArray([1n, 2n], new Int64()).concat(vectorFromArray([3n], new Int64()))

    expect(await encodeColumn(vector)).toEqual(['1', '2', '3'])
  })

  describe('a cell', () => {
    it.each<[string, Vector, JsonValue[]]>([
      ['a null', makeVector(makeData({ type: new Null(), length: 2 })), [null, null]],
      [
        'a value past the end of its buffer as null',
        makeVector(makeData({ type: new Int32(), length: 2, data: Int32Array.of(1) })),
        [1, null],
      ],
      ['an int8', vectorFromArray([-128, 127, null], new Int8()), [-128, 127, null]],
      [
        'an int64 as a string',
        vectorFromArray([2n ** 53n + 1n, -(2n ** 63n)], new Int64()),
        ['9007199254740993', '-9223372036854775808'],
      ],
      [
        'a uint64 as a string',
        vectorFromArray([2n ** 63n, 2n ** 64n - 1n], new Uint64()),
        ['9223372036854775808', '18446744073709551615'],
      ],
      ['a float', vectorFromArray([0.5, -1e21], new Float64()), [0.5, -1e21]],
      ['a float32', vectorFromArray([0.5, -2.25], new Float32()), [0.5, -2.25]],
      [
        'a float that is NaN or infinite as null',
        vectorFromArray([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY], new Float64()),
        [null, null, null],
      ],
      ['a boolean', vectorFromArray([true, false, null], new Bool()), [true, false, null]],
      ['a string', vectorFromArray(['žluťoučký', '', 'a"b\\c\n'], new Utf8()), ['žluťoučký', '', 'a"b\\c\n']],
      ['a large string', vectorFromArray(['x'], new LargeUtf8()), ['x']],
      [
        'a string view',
        vectorFromArray(['short', 'a string longer than twelve'], new Utf8View()),
        ['short', 'a string longer than twelve'],
      ],
      [
        'binary as base64',
        vectorFromArray([Uint8Array.of(0, 255), Uint8Array.of(1, 2, 3), Uint8Array.of()], new Binary()),
        ['AP8=', 'AQID', ''],
      ],
      ['a large binary as base64', vectorFromArray([Uint8Array.of(0, 255)], new LargeBinary()), ['AP8=']],
      ['a binary view as base64', vectorFromArray([Uint8Array.of(0, 255)], new BinaryView()), ['AP8=']],
      [
        'a dictionary value',
        vectorFromArray(['b', 'a', 'b', null], new Dictionary(new Utf8(), new Int8())),
        ['b', 'a', 'b', null],
      ],
      ['a date from days', makeVector(makeData({ type: new DateDay(), data: Int32Array.of(19_724) })), ['2024-01-02']],
      [
        'a date from milliseconds',
        makeVector(makeData({ type: new DateMillisecond(), data: BigInt64Array.of(1_704_164_645_678n) })),
        ['2024-01-02'],
      ],
      [
        'a timestamp with a time zone, with a Z',
        makeVector(
          makeData({ type: new TimestampNanosecond('UTC'), data: BigInt64Array.of(1_704_164_645_678_000_200n) })
        ),
        ['2024-01-02T03:04:05.678Z'],
      ],
      [
        'a timestamp of an unknown time zone, in UTC with a Z',
        makeVector(makeData({ type: new TimestampMillisecond('Not/AZone'), data: BigInt64Array.of(0n) })),
        ['1970-01-01T00:00:00.000Z'],
      ],
      [
        'a timestamp without a time zone, without a Z',
        makeVector(makeData({ type: new TimestampSecond(), data: BigInt64Array.of(1_704_164_645n) })),
        ['2024-01-02T03:04:05.000'],
      ],
      [
        'a timestamp before the epoch, rounded down to the millisecond',
        makeVector(makeData({ type: new TimestampNanosecond(), data: BigInt64Array.of(-500_000n) })),
        ['1969-12-31T23:59:59.999'],
      ],
      [
        'a time in seconds',
        makeVector(makeData({ type: new TimeSecond(), data: Int32Array.of(3661) })),
        ['01:01:01.000'],
      ],
      [
        'a time in milliseconds',
        makeVector(makeData({ type: new TimeMillisecond(), data: Int32Array.of(86_399_999) })),
        ['23:59:59.999'],
      ],
      [
        'a time in microseconds, cut to the millisecond',
        makeVector(makeData({ type: new TimeMicrosecond(), data: BigInt64Array.of(3_723_004_999n) })),
        ['01:02:03.004'],
      ],
      [
        'a time in nanoseconds, cut to the millisecond',
        makeVector(makeData({ type: new TimeNanosecond(), data: BigInt64Array.of(3_723_004_999_999n) })),
        ['01:02:03.004'],
      ],
      ['a duration in seconds', makeVector(makeData({ type: new DurationSecond(), data: BigInt64Array.of(2n) })), [2]],
      [
        'a duration in milliseconds',
        makeVector(makeData({ type: new DurationMillisecond(), data: BigInt64Array.of(1500n) })),
        [1.5],
      ],
      [
        'a duration in microseconds',
        makeVector(makeData({ type: new DurationMicrosecond(), data: BigInt64Array.of(2_500_000n) })),
        [2.5],
      ],
      [
        'a duration in nanoseconds',
        makeVector(
          makeData({ type: new DurationNanosecond(), data: BigInt64Array.of(1_500_000_000n, -1_500_000_000n) })
        ),
        [1.5, -1.5],
      ],
      [
        'a duration in microseconds longer than 2^53 nanoseconds, correctly rounded',
        makeVector(makeData({ type: new DurationMicrosecond(), data: BigInt64Array.of(134_060_549_817_101n) })),
        [134060549.817101],
      ],
      [
        'a float16, with infinities as null',
        vectorFromArray([0.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY], new Float16()),
        [0.5, null, null],
      ],
      [
        'a dictionary-encoded timestamp as ISO text',
        makeVector(
          makeData({
            type: new Dictionary(new TimestampNanosecond(), new Int32()),
            length: 3,
            data: Int32Array.of(1, 0, 1),
            dictionary: makeVector(makeData({ type: new TimestampNanosecond(), data: BigInt64Array.of(-500n, 0n) })),
          })
        ),
        ['1970-01-01T00:00:00.000', '1969-12-31T23:59:59.999', '1970-01-01T00:00:00.000'],
      ],
      [
        'a time past 24 hours, without wrapping the hours',
        makeVector(makeData({ type: new TimeSecond(), data: Int32Array.of(90_061) })),
        ['25:01:01.000'],
      ],
    ])('writes %s', async (_, vector, expected) => {
      expect(await encodeColumn(vector)).toEqual(expected)
    })

    it.each<[number, bigint, number, string]>([
      [128, 12_345n, 2, '123.45'],
      [128, -5n, 7, '-0.0000005'],
      [128, 12n, -2, '1200'],
      [128, 0n, 2, '0.00'],
      [128, 0n, -2, '0'],
      [128, 2n ** 100n, 0, '1267650600228229401496703205376'],
      [32, -1235n, 2, '-12.35'],
      [64, -1235n, 2, '-12.35'],
      [256, 1_234_567n, 3, '1234.567'],
      [256, -5n, 7, '-0.0000005'],
    ])('writes a decimal%i of %i at scale %i as %s', async (bitWidth, unscaled, scale, expected) => {
      expect(await encodeColumn(decimalVector(bitWidth, [unscaled], scale))).toEqual([expected])
    })

    it('writes an arrow.uuid as lowercase hex in groups', async () => {
      const field = uuidField('value')
      const vector = vectorFromArray([uuidBytes('12345678-1234-5678-1234-567812345678'), null], field.type)

      expect(await encodeColumn(vector, field)).toEqual(['12345678-1234-5678-1234-567812345678', null])
    })

    it.each<[string, Field, number[], string]>([
      [
        'a 16-byte binary without the extension',
        new Field('v', new FixedSizeBinary(16)),
        Array(16).fill(0),
        'AAAAAAAAAAAAAAAAAAAAAA==',
      ],
      [
        'a 16-byte binary of another extension',
        new Field('v', new FixedSizeBinary(16), true, new Map([['ARROW:extension:name', 'x.y']])),
        Array(16).fill(0),
        'AAAAAAAAAAAAAAAAAAAAAA==',
      ],
      ['an arrow.uuid of 4 bytes', uuidField('v', 4), [1, 2, 3, 4], 'AQIDBA=='],
    ])('writes %s as base64', async (_, field, bytes, expected) => {
      expect(await encodeColumn(vectorFromArray([Uint8Array.from(bytes)], field.type), field)).toEqual([expected])
    })

    it('refuses a column of a type it cannot encode', async () => {
      const vector = makeVector(makeData({ type: new IntervalYearMonth(), data: Int32Array.of(14) }))

      await expect(encodeColumn(vector)).rejects.toThrow(UnsupportedArrowTypeError)
      await expect(encodeColumn(vector)).rejects.toThrow(expect.objectContaining({ reason: 'unsupported_column_type' }))
    })
  })

  describe('a nested value', () => {
    it('writes a list as an array, with the items encoded by their own type', async () => {
      const vector = vectorFromArray([[1n, 2n ** 60n], null, []], new List(new Field('item', new Int64())))

      expect(await encodeColumn(vector)).toEqual([['1', '1152921504606846976'], null, []])
    })

    it('writes a large list as an array', async () => {
      const vector = vectorFromArray([[1, 2], null], new LargeList(new Field('item', new Int32())))

      expect(await encodeColumn(vector)).toEqual([[1, 2], null])
    })

    it('writes a fixed-size list as an array', async () => {
      const vector = vectorFromArray([[1, 2], null], new FixedSizeList(2, new Field('item', new Int32())))

      expect(await encodeColumn(vector)).toEqual([[1, 2], null])
    })

    it('writes a struct as an object keyed by field name, with a uuid child as text', async () => {
      const field = new Field('owner', new Struct([uuidField('id'), new Field('name', new Utf8())]))
      const vector = vectorFromArray(
        [{ id: uuidBytes('abcdef01-2345-6789-abcd-ef0123456789'), name: 'a' }, { id: null, name: null }, null],
        field.type
      )

      expect(await encodeColumn(vector, field)).toEqual([
        { id: 'abcdef01-2345-6789-abcd-ef0123456789', name: 'a' },
        { id: null, name: null },
        null,
      ])
    })

    it('keeps a struct field named __proto__ as a field of the object', async () => {
      const vector = vectorFromArray([{ ['__proto__']: 'x' }], new Struct([new Field('__proto__', new Utf8())]))

      expect(JSON.stringify(await encodeColumn(vector))).toEqual('[{"__proto__":"x"}]')
    })

    it('writes a map as an array of [key, value] pairs', async () => {
      const vector = vectorFromArray(
        [
          new Map([
            [1, 'x'],
            [2, 'y'],
          ]),
          null,
          new Map(),
        ],
        mapType(new Int32(), new Utf8())
      )

      expect(await encodeColumn(vector)).toEqual([
        [
          [1, 'x'],
          [2, 'y'],
        ],
        null,
        [],
      ])
    })

    it('writes a map column sliced as a page slices it', async () => {
      const vector = vectorFromArray(
        [new Map([[1, 'x']]), null, new Map([[2, 'y']])],
        mapType(new Int32(), new Utf8())
      ).slice(1, 3)

      expect(await encodeColumn(vector)).toEqual([null, [[2, 'y']]])
    })

    it.each<[string, (map: Data) => Data, JsonValue]>([
      ['as a map value', map => mapWithOffsets(Int32Array.of(0, 1), int32Data(7), map), [[7, []]]],
      [
        'as a dictionary value',
        map =>
          makeData({
            type: new Dictionary(map.type, new Int32()),
            length: 1,
            data: Int32Array.of(0),
            dictionary: makeVector(map),
          }),
        [],
      ],
    ])('reads a map %s without the cache apache-arrow builds of its keys', async (_, wrap, cell) => {
      expect(await encodeColumn(makeVector(wrap(emptyMapOfHugeDictionaryKeys())))).toEqual([cell])
    })

    it('writes the struct inside a map value', async () => {
      const vector = vectorFromArray(
        [new Map([['k', { a: 5n }]])],
        mapType(new Utf8(), new Struct([new Field('a', new Int64())]))
      )

      expect(await encodeColumn(vector)).toEqual([[['k', { a: '5' }]]])
    })

    it('writes the list inside a struct', async () => {
      const vector = vectorFromArray(
        [{ tags: [1, 22] }, { tags: null }],
        new Struct([new Field('tags', new List(new Field('item', new Int32())))])
      )

      expect(await encodeColumn(vector)).toEqual([{ tags: [1, 22] }, { tags: null }])
    })

    it('writes a NaN inside a list and as a map value as null', async () => {
      const list = vectorFromArray([[1.5, Number.NaN]], new FixedSizeList(2, new Field('item', new Float64())))
      const map = vectorFromArray(
        [
          new Map([
            [2n, 1.5],
            [1n, Number.NaN],
          ]),
        ],
        mapType(new Int64(), new Float64())
      )

      expect(await encodeColumn(list)).toEqual([[1.5, null]])
      expect(await encodeColumn(map)).toEqual([
        [
          ['2', 1.5],
          ['1', null],
        ],
      ])
    })
  })

  describe('a date or timestamp', () => {
    const timestamp = (milliseconds: bigint) =>
      makeVector(makeData({ type: new TimestampMillisecond(), data: BigInt64Array.of(milliseconds) }))

    it.each<[string, bigint, string]>([
      ['the first millisecond of year 0', -62_167_219_200_000n, '0000-01-01T00:00:00.000'],
      ['the last millisecond of year 9999', 253_402_300_799_999n, '9999-12-31T23:59:59.999'],
    ])('is served at %s', async (_, milliseconds, expected) => {
      expect(await encodeColumn(timestamp(milliseconds))).toEqual([expected])
    })

    it("is cut to the millisecond at Python's datetime.max, in microseconds", async () => {
      const vector = makeVector(
        makeData({ type: new TimestampMicrosecond('UTC'), data: BigInt64Array.of(253_402_300_799_999_999n) })
      )

      expect(await encodeColumn(vector)).toEqual(['9999-12-31T23:59:59.999Z'])
    })

    it.each<[string, Vector]>([
      ['the millisecond before year 0', timestamp(-62_167_219_200_001n)],
      ['the first millisecond of year 10000', timestamp(253_402_300_800_000n)],
      ['a date in year 10000', makeVector(makeData({ type: new DateDay(), data: Int32Array.of(2_932_897) }))],
      ['a timestamp beyond 2^53 milliseconds', timestamp(2n ** 60n)],
      ['a date beyond 2^53 milliseconds in a map', mapOf(dateData(2n ** 60n))],
      ['a date beyond 2^53 milliseconds in a struct', structOf(dateData(2n ** 60n))],
      [
        'a date past the end of its buffer',
        makeVector(makeData({ type: new DateDay(), length: 2, data: Int32Array.of(1) })),
      ],
    ])('is unservable at %s', async (_, vector) => {
      await expect(encodeColumn(vector)).rejects.toThrow(
        expect.objectContaining({
          reason: 'date_out_of_range',
          message: 'The page holds a date or timestamp outside the years 0 to 9999, which the server cannot format.',
        })
      )
    })
  })

  describe('a value apache-arrow cannot read', () => {
    const tooLarge = 2n ** 60n

    it.each<[string, Vector, string]>([
      [
        'at row 1 of a column',
        makeVector(largeUtf8Data(0n, 0n, tooLarge)),
        'Row 1 could not be read: 1152921504606846976 is not safe to convert to a number.',
      ],
      [
        'in a map value',
        mapOf(largeUtf8Data(0n, tooLarge)),
        'Row 0 could not be read: 1152921504606846976 is not safe to convert to a number.',
      ],
      [
        'in a map key',
        makeVector(mapWithOffsets(Int32Array.of(0, 1), largeUtf8Data(0n, tooLarge))),
        'Row 0 could not be read: 1152921504606846976 is not safe to convert to a number.',
      ],
      [
        'in a column whose null bitmap is shorter than its rows',
        makeVector(
          makeData({
            type: new Int32(),
            length: 1000,
            nullBitmap: Uint8Array.of(0b11111000),
            data: new Int32Array(1000),
          })
        ),
        'Row 0 could not be read: Offset is outside the bounds of the DataView',
      ],
      [
        'in a map column whose null bitmap is shorter than its rows',
        makeVector(
          makeData({
            type: mapWithOffsets(Int32Array.of(0)).type,
            length: 1000,
            nullBitmap: Uint8Array.of(0b11111000),
            valueOffsets: new Int32Array(1001),
            child: mapWithOffsets(Int32Array.of(0)).children[0],
          })
        ),
        'Row 0 could not be read: Offset is outside the bounds of the DataView',
      ],
    ])('is reported as an invalid frame %s', async (_, vector, message) => {
      await expect(encodeColumn(vector)).rejects.toThrow(InvalidArrowFileError)
      await expect(encodeColumn(vector)).rejects.toThrow(message)
    })

    it.each<[string, Vector]>([
      [
        'in the list of row 2',
        makeVector(
          makeData({
            type: new List(new Field('item', new LargeUtf8())),
            length: 3,
            nullCount: 0,
            valueOffsets: Int32Array.of(0, 1, 2, 3),
            child: largeUtf8Data(0n, 0n, 0n, tooLarge),
          })
        ),
      ],
      [
        'in the second field of the struct of row 2',
        makeVector(
          makeData({
            type: new Struct([new Field('a', new Int32()), new Field('b', new LargeUtf8())]),
            length: 3,
            nullCount: 0,
            children: [makeData({ type: new Int32(), data: new Int32Array(3) }), largeUtf8Data(0n, 0n, 0n, tooLarge)],
          })
        ),
      ],
    ])('is reported at the row that holds it when %s', async (_, vector) => {
      await expect(encodeColumn(vector)).rejects.toThrow(InvalidArrowFileError)
      await expect(encodeColumn(vector)).rejects.toThrow(
        'Row 2 could not be read: 1152921504606846976 is not safe to convert'
      )
    })

    it("is reported as an unreadable row caused by the unreadable value, which apache-arrow's error caused", async () => {
      await expect(encodeColumn(makeVector(largeUtf8Data(0n, 0n, tooLarge)))).rejects.toThrow(
        expect.objectContaining({
          reason: 'unreadable_row',
          cause: expect.objectContaining({ reason: 'unreadable_value', cause: expect.any(Error) }),
        })
      )
    })
  })

  describe('charges', () => {
    const everyType = (): ArrowPageColumn[] => {
      const idField = uuidField('id')
      const ownerType = new Struct([new Field('a', new Int64()), new Field('ž"b', new Utf8())])
      const scoresType = mapType(new Int32(), new Utf8())
      const tagsType = new List(new Field('item', new Int32()))
      return [
        { field: new Field('large', new Int64()), vector: vectorFromArray([2n ** 60n, null, -3n], new Int64()) },
        { field: new Field('ratio', new Float64()), vector: vectorFromArray([0.1, Number.NaN, 1e21], new Float64()) },
        { field: new Field('flag', new Bool()), vector: vectorFromArray([true, false, null], new Bool()) },
        {
          field: new Field('text', new Utf8()),
          vector: vectorFromArray(['žluťoučký', 'a"b\\c\n\u0001', null], new Utf8()),
        },
        { field: new Field('nothing', new Null()), vector: makeVector(makeData({ type: new Null(), length: 3 })) },
        {
          field: new Field('at', new TimestampSecond('Europe/Prague')),
          vector: makeVector(
            makeData({
              type: new TimestampSecond('Europe/Prague'),
              data: BigInt64Array.of(0n, 1_700_000_000n, 0n),
              nullBitmap: Uint8Array.of(0b011),
            })
          ),
        },
        {
          field: new Field('day', new DateDay()),
          vector: vectorFromArray([new Date(Date.UTC(2025, 0, 2)), null, null], new DateDay()),
        },
        {
          field: new Field('price', new Decimal(2, 22, 128)),
          vector: decimalVector(128, [12_345n, -12_345n, 0n], 2, Uint8Array.of(0b011)),
        },
        {
          field: new Field('scaled', new Decimal(-2, 22, 128)),
          vector: decimalVector(128, [12n, -12n, 0n], -2, Uint8Array.of(0b011)),
        },
        {
          field: new Field('payload', new Binary()),
          vector: vectorFromArray([Uint8Array.of(0x61, 0x62), Uint8Array.of(1, 2, 3), null], new Binary()),
        },
        {
          field: idField,
          vector: vectorFromArray([uuidBytes('12345678-1234-5678-1234-567812345678'), null, null], idField.type),
        },
        { field: new Field('tags', tagsType), vector: vectorFromArray([[1, 22], [], null], tagsType) },
        {
          field: new Field('owner', ownerType),
          vector: vectorFromArray([{ a: 1n, 'ž"b': 'x' }, null, { a: null, 'ž"b': null }], ownerType),
        },
        {
          field: new Field('scores', scoresType),
          vector: vectorFromArray(
            [
              new Map([
                [1, 'a'],
                [2, null],
              ]),
              null,
              new Map(),
            ],
            scoresType
          ),
        },
        {
          field: new Field('level', new Dictionary(new Utf8(), new Int8())),
          vector: vectorFromArray(['hi', 'hi', null], new Dictionary(new Utf8(), new Int8())),
        },
        {
          field: new Field('clock', new TimeMillisecond()),
          vector: makeVector(makeData({ type: new TimeMillisecond(), data: Int32Array.of(1, 2, 3) })),
        },
        {
          field: new Field('took', new DurationSecond()),
          vector: makeVector(makeData({ type: new DurationSecond(), data: BigInt64Array.of(1n, 2n, 3n) })),
        },
      ]
    }

    it('charges the UTF-8 bytes of the JSON of the rows for every type, nested values and escaped text', async () => {
      const { rows, json } = await chargeAll(everyType(), 3)

      expect(json).toEqual(Buffer.byteLength(JSON.stringify(rows)))
    })

    it('charges one value for each cell, list item, struct field, map key and map value', async () => {
      const cells = 17 * 3
      const listItems = 2
      const structFields = 2 * 2
      const mapKeysAndValues = 2 * 2

      expect((await chargeAll(everyType(), 3)).values).toEqual(cells + listItems + structFields + mapKeysAndValues)
    })

    it('charges the structure and each value of a small page', async () => {
      const columns = [
        { field: new Field('a', new Utf8()), vector: vectorFromArray(['a', null], new Utf8()) },
        { field: new Field('b', new Int32()), vector: vectorFromArray([1, 22], new Int32()) },
      ]

      expect((await chargeAll(columns, 2)).json).toEqual('[["a",1],[null,22]]'.length)
    })

    it('writes no rows for an empty page, and charges the two bytes of its brackets', async () => {
      const columns = [{ field: new Field('b', new Int32()), vector: vectorFromArray([], new Int32()) }]
      const { rows, json } = await chargeAll(columns, 0)

      expect(rows).toEqual([])
      expect(json).toEqual(2)
    })

    it('stops when a callback throws, and passes the error on', async () => {
      const columns = [{ field: new Field('a', new Int32()), vector: vectorFromArray([1], new Int32()) }]

      await expect(
        encodeRows(columns, 1, {
          chargeValues: () => {
            throw new Error('Too many values')
          },
        })
      ).rejects.toThrow('Too many values')
      await expect(
        encodeRows(columns, 1, {
          chargeJsonBytes: () => {
            throw new Error('Too many bytes')
          },
        })
      ).rejects.toThrow('Too many bytes')
    })

    it('stops before it builds the next value of a dictionary column that repeats one large string', async () => {
      const value = 'x'.repeat(2 ** 20)
      const type = new Dictionary(new Utf8(), new Int8())
      const columns = [
        { field: new Field('level', type), vector: vectorFromArray(new Array<string>(1000).fill(value), type) },
      ]
      let total = 0
      const charge = (bytes: number) => {
        total += bytes
        if (total > 2 * 2 ** 20) {
          throw new Error('Over budget')
        }
      }

      await expect(encodeRows(columns, 1000, { chargeJsonBytes: charge })).rejects.toThrow('Over budget')
      expect(total).toBeLessThan(4 * 2 ** 20)
    })

    it.each([
      ['a positive scale', 2_000_000_000, 2_000_000_004],
      ['a negative scale', -2_000_000_000, 2_000_000_003],
    ])(
      'charges a decimal of %s before it builds the text, since a forged scale can make it gigabytes long',
      async (_, scale, textBytes) => {
        const charges: number[] = []
        const columns = [
          { field: new Field('d', new Decimal(scale, 38, 128)), vector: decimalVector(128, [1n], scale) },
        ]
        const charge = (bytes: number) => {
          charges.push(bytes)
          if (bytes > 2 ** 20) {
            throw new Error('Over budget')
          }
        }

        await expect(encodeRows(columns, 1, { chargeJsonBytes: charge })).rejects.toThrow('Over budget')
        expect(charges).toEqual([2, 2, textBytes])
      }
    )

    it('charges the length of a string before it escapes it, since each control character takes six bytes', async () => {
      const vector = vectorFromArray(['\u0001'.repeat(10_000)], new Utf8())
      const charges: number[] = []
      const charge = (bytes: number) => {
        charges.push(bytes)
        if (bytes >= 10_000) {
          throw new Error('Over budget')
        }
      }

      await expect(
        encodeRows([{ field: new Field('s', new Utf8()), vector }], 1, { chargeJsonBytes: charge })
      ).rejects.toThrow('Over budget')
      expect(charges).toEqual([2, 2, 10_002])
    })

    it.each<[string, Vector]>([
      ['a list', listOf(invalidArrowFileErrorTrap())],
      ['a struct', structOf(invalidArrowFileErrorTrap())],
      ['a map', mapOf(invalidArrowFileErrorTrap())],
    ])('stops at the values of %s before it reads any of them', async (_, vector) => {
      let calls = 0
      const chargeValues = () => {
        calls += 1
        if (calls === 2) {
          throw new Error('Over budget')
        }
      }

      await expect(encodeRows([{ field: new Field('c', vector.type), vector }], 1, { chargeValues })).rejects.toThrow(
        'Over budget'
      )
    })

    it('charges a map before it allocates anything of its length, which a forged offset makes 2^25 entries', async () => {
      const vector = makeVector(mapWithOffsets(Int32Array.of(0, 2 ** 25)))
      const heapBefore = process.memoryUsage().heapUsed
      let heapAtCharge = Number.NaN
      const chargeValues = (count: number) => {
        if (count >= 2 ** 25) {
          heapAtCharge = process.memoryUsage().heapUsed
          throw new Error('Over budget')
        }
      }

      await expect(encodeRows([{ field: new Field('m', vector.type), vector }], 1, { chargeValues })).rejects.toThrow(
        'Over budget'
      )
      // apache-arrow's MapRow runs new Array(size), which V8 backs with 8 bytes per slot up to 2^25 slots and sparsely
      // beyond, so 256 MiB here. Both readings measure this thread's heap, with only this test's synchronous code
      // between them, and a garbage collection only lowers the difference.
      expect(heapAtCharge - heapBefore).toBeLessThan(64 * 2 ** 20)
    })

    it('charges a binary value before it builds the base64, which is a third longer than the value', async () => {
      const data = new Uint8Array(2 ** 25)
      const vector = makeVector(
        makeData({ type: new Binary(), length: 1, valueOffsets: Int32Array.of(0, data.length), data })
      )
      const before = process.memoryUsage()
      let allocatedAtCharge = Number.NaN
      const chargeJsonBytes = (bytes: number) => {
        if (bytes >= 2 ** 25) {
          const atCharge = process.memoryUsage()
          allocatedAtCharge = atCharge.heapUsed + atCharge.external - before.heapUsed - before.external
          throw new Error('Over budget')
        }
      }

      await expect(
        encodeRows([{ field: new Field('b', vector.type), vector }], 1, { chargeJsonBytes })
      ).rejects.toThrow('Over budget')
      // Node keeps a string this long outside the V8 heap, so the 43 MiB of base64 counts as external memory.
      expect(allocatedAtCharge).toBeLessThan(16 * 2 ** 20)
    })

    it.each<[string, ArrowPageColumn[]]>([
      [
        'the next field of a struct',
        [
          {
            field: new Field('c', new Struct([new Field('s', new Utf8()), new Field('d', new LargeUtf8())])),
            vector: makeVector(
              makeData({
                type: new Struct([new Field('s', new Utf8()), new Field('d', new LargeUtf8())]),
                length: 1,
                children: [vectorFromArray(['x'.repeat(100)], new Utf8()).data[0], invalidArrowFileErrorTrap()],
              })
            ),
          },
        ],
      ],
      [
        'the next column',
        [
          { field: new Field('s', new Utf8()), vector: vectorFromArray(['x'.repeat(100)], new Utf8()) },
          { field: new Field('d', new LargeUtf8()), vector: makeVector(invalidArrowFileErrorTrap()) },
        ],
      ],
      [
        'the value of a map entry',
        [
          {
            field: new Field('m', mapType(new Utf8(), new LargeUtf8())),
            vector: makeVector(
              mapWithOffsets(
                Int32Array.of(0, 1),
                vectorFromArray(['x'.repeat(100)], new Utf8()).data[0],
                invalidArrowFileErrorTrap()
              )
            ),
          },
        ],
      ],
      [
        'the next item of a list',
        [
          {
            field: new Field('l', new List(new Field('item', new LargeUtf8()))),
            vector: listOf(invalidArrowFileErrorTrap('x'.repeat(100))),
          },
        ],
      ],
      [
        'the key of the next map entry',
        [
          {
            field: new Field('m', mapType(new LargeUtf8(), new Int32())),
            vector: makeVector(mapWithOffsets(Int32Array.of(0, 2), invalidArrowFileErrorTrap('x'.repeat(100)))),
          },
        ],
      ],
    ])('charges a large value before it reads %s', async (_, columns) => {
      const charge = (bytes: number) => {
        if (bytes > 50) {
          throw new Error('Over budget')
        }
      }

      await expect(encodeRows(columns, 1, { chargeJsonBytes: charge })).rejects.toThrow('Over budget')
    })

    it('writes the same rows without hooks as with hooks that never throw', async () => {
      const { rows } = await chargeAll(everyType(), 3)

      expect(await encodeRows(everyType(), 3)).toEqual(rows)
    })

    it('charges the values when chargeValues is the only hook', async () => {
      const tagsType = new List(new Field('item', new Int32()))
      const columns = [{ field: new Field('tags', tagsType), vector: vectorFromArray([[1, 22, 333], null], tagsType) }]
      const chargeValues = vi.fn()

      expect(await encodeRows(columns, 2, { chargeValues })).toEqual([[[1, 22, 333]], [null]])
      expect(chargeValues.mock.calls).toEqual([[2], [3]])
    })

    it.each<[string, EncodeRowsHooks | undefined]>([
      ['without hooks', undefined],
      ['with only chargeValues', { chargeValues: vi.fn() }],
    ])('never calls JSON.stringify %s', async (_, hooks) => {
      const ownerType = new Struct([new Field('name', new Utf8())])
      const columns = [
        { field: new Field('text', new Utf8()), vector: vectorFromArray(['a"b'], new Utf8()) },
        { field: new Field('owner', ownerType), vector: vectorFromArray([{ name: 'x' }], ownerType) },
      ]
      const stringify = vi.spyOn(JSON, 'stringify')
      let calls = Number.NaN
      const rows = await encodeRows(columns, 1, hooks).finally(() => {
        calls = stringify.mock.calls.length
        stringify.mockRestore()
      })

      expect(rows).toEqual([['a"b', { name: 'x' }]])
      expect(calls).toBe(0)
    })

    function throwOnThirdCall(error: Error) {
      let calls = 0
      return () => {
        calls += 1
        if (calls === 3) {
          throw error
        }
      }
    }

    it.each<[string, Error]>([
      ['an UnservablePageError', new UnservablePageError('page_too_large', 'The page is too large.')],
      ["a consumer's own error", new Error('Budget store unavailable')],
    ])('rejects with the instance of %s that chargeJsonBytes throws for a cell', async (_, refusal) => {
      const columns = [{ field: new Field('a', new Int32()), vector: vectorFromArray([1], new Int32()) }]

      await expect(encodeRows(columns, 1, { chargeJsonBytes: throwOnThirdCall(refusal) })).rejects.toBe(refusal)
    })

    it('reports an InvalidArrowFileError that chargeJsonBytes throws for a cell as an unreadable row', async () => {
      const columns = [{ field: new Field('a', new Int32()), vector: vectorFromArray([1], new Int32()) }]
      const refusal = new InvalidArrowFileError('test_budget', 'Budget hook refused')

      const error = await encodeRows(columns, 1, { chargeJsonBytes: throwOnThirdCall(refusal) }).catch(
        (caught: unknown) => caught
      )

      expect(error).toBeInstanceOf(InvalidArrowFileError)
      expect(error).toMatchObject({ reason: 'unreadable_row', message: 'Row 0 could not be read: Budget hook refused' })
      expect(error instanceof InvalidArrowFileError && error.cause).toBe(refusal)
    })
  })

  function repeatedColumn(type: DataType, value: unknown): ArrowPageColumn {
    return {
      field: new Field('c', type),
      vector: vectorFromArray(
        Array.from({ length: 250 }, () => value),
        type
      ),
    }
  }

  it.each<[string, number, ArrowPageColumn[]]>([
    ['every 100th row of an Int32 column', 2, [repeatedColumn(new Int32(), 1)]],
    [
      'every 50th row of a dictionary-encoded Utf8 column',
      5,
      [repeatedColumn(new Dictionary(new Utf8(), new Int32()), 'a')],
    ],
    ['every 50th row of a Binary column', 5, [repeatedColumn(new Binary(), Uint8Array.of(1))]],
    ['every 20th row of a list column', 12, [repeatedColumn(new List(new Field('item', new Int32())), [1])]],
    ['every 20th row of a struct column', 12, [repeatedColumn(new Struct([new Field('d', new Int32())]), { d: 1 })]],
    ['every 20th row of a map column', 12, [repeatedColumn(mapType(new Int32(), new Utf8()), new Map([[1, 'x']]))]],
    ['every 20th row of 201 Int32 columns', 12, Array.from({ length: 201 }, () => repeatedColumn(new Int32(), 1))],
    [
      'every 20th row of a Utf8 column beside a list column',
      12,
      [repeatedColumn(new Utf8(), 'a'), repeatedColumn(new List(new Field('item', new Int32())), [1])],
    ],
  ])('lets the event loop turn after %s, %i times in 250 rows', async (_, turns, columns) => {
    expect(await countEventLoopTurnsDuring(() => encodeRows(columns, 250))).toEqual(turns)
  })
})
