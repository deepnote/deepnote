// cspell:ignore AQID
import {
  Binary,
  Bool,
  DateDay,
  Decimal,
  Dictionary,
  DurationMillisecond,
  Field,
  Float64,
  Int8,
  Int32,
  Int64,
  List,
  makeData,
  makeVector,
  Null,
  Schema,
  Struct,
  TimeMillisecond,
  TimestampMillisecond,
  Utf8,
  vectorFromArray,
} from 'apache-arrow'
import { expect, it } from 'vitest'
import { type ArrowPageColumn, DATAFRAME_COLUMN_TYPES, describeColumns, encodeRows } from './json-values'
import { decimalVector, mapType, uuidBytes, uuidField } from './json-values.fixtures'

it('describes and encodes a page of every column type as this JSON', async () => {
  const idField = uuidField('id')
  const tagsType = new List(new Field('item', new Utf8()))
  const addressType = new Struct([new Field('city', new Utf8()), new Field('floor', new Int32())])
  const ratingsType = mapType(new Utf8(), new Int32())
  const planType = new Dictionary(new Utf8(), new Int8())
  const instants = BigInt64Array.of(1_704_164_645_678n, 0n)
  const columns: ArrowPageColumn[] = [
    {
      field: idField,
      vector: vectorFromArray([uuidBytes('0f8fad5b-d9cb-469f-a165-70867728950e'), null], idField.type),
    },
    { field: new Field('name', new Utf8()), vector: vectorFromArray(['Ada Lovelace', null], new Utf8()) },
    { field: new Field('age', new Int32()), vector: vectorFromArray([36, null], new Int32()) },
    { field: new Field('visits', new Int64()), vector: vectorFromArray([2n ** 53n + 1n, null], new Int64()) },
    { field: new Field('score', new Float64()), vector: vectorFromArray([0.5, null], new Float64()) },
    { field: new Field('active', new Bool()), vector: vectorFromArray([true, null], new Bool()) },
    { field: new Field('avatar', new Binary()), vector: vectorFromArray([Uint8Array.of(1, 2, 3), null], new Binary()) },
    {
      field: new Field('balance', new Decimal(2, 38, 128)),
      vector: decimalVector(128, [12_345n, 0n], 2, Uint8Array.of(0b01)),
    },
    {
      field: new Field('born', new DateDay()),
      vector: vectorFromArray([new Date(Date.UTC(1815, 11, 10)), null], new DateDay()),
    },
    {
      field: new Field('signed_up_at', new TimestampMillisecond('Europe/Prague')),
      vector: makeVector(
        makeData({ type: new TimestampMillisecond('Europe/Prague'), data: instants, nullBitmap: Uint8Array.of(0b01) })
      ),
    },
    {
      field: new Field('last_seen_at', new TimestampMillisecond()),
      vector: makeVector(
        makeData({ type: new TimestampMillisecond(), data: instants, nullBitmap: Uint8Array.of(0b01) })
      ),
    },
    {
      field: new Field('wakes_at', new TimeMillisecond()),
      vector: makeVector(
        makeData({ type: new TimeMillisecond(), data: Int32Array.of(27_000_000, 0), nullBitmap: Uint8Array.of(0b01) })
      ),
    },
    {
      field: new Field('session', new DurationMillisecond()),
      vector: makeVector(
        makeData({
          type: new DurationMillisecond(),
          data: BigInt64Array.of(90_500n, 0n),
          nullBitmap: Uint8Array.of(0b01),
        })
      ),
    },
    { field: new Field('tags', tagsType), vector: vectorFromArray([['math', 'poetry'], null], tagsType) },
    {
      field: new Field('address', addressType),
      vector: vectorFromArray([{ city: 'London', floor: 2 }, null], addressType),
    },
    { field: new Field('ratings', ratingsType), vector: vectorFromArray([new Map([['math', 5]]), null], ratingsType) },
    { field: new Field('plan', planType), vector: vectorFromArray(['pro', null], planType) },
    { field: new Field('nothing', new Null()), vector: makeVector(makeData({ type: new Null(), length: 2 })) },
  ]
  const page = {
    columns: describeColumns(new Schema(columns.map(({ field }) => field))),
    rows: await encodeRows(columns, 2),
  }

  expect(new Set(page.columns.map(({ type }) => type))).toEqual(new Set(DATAFRAME_COLUMN_TYPES))
  expect(JSON.stringify(page, null, 2)).toMatchInlineSnapshot(`
    "{
      "columns": [
        {
          "name": "id",
          "type": "string",
          "timezone": null
        },
        {
          "name": "name",
          "type": "string",
          "timezone": null
        },
        {
          "name": "age",
          "type": "integer",
          "timezone": null
        },
        {
          "name": "visits",
          "type": "int64",
          "timezone": null
        },
        {
          "name": "score",
          "type": "float",
          "timezone": null
        },
        {
          "name": "active",
          "type": "boolean",
          "timezone": null
        },
        {
          "name": "avatar",
          "type": "binary",
          "timezone": null
        },
        {
          "name": "balance",
          "type": "decimal",
          "timezone": null
        },
        {
          "name": "born",
          "type": "date",
          "timezone": null
        },
        {
          "name": "signed_up_at",
          "type": "timestamp",
          "timezone": "Europe/Prague"
        },
        {
          "name": "last_seen_at",
          "type": "timestamp",
          "timezone": null
        },
        {
          "name": "wakes_at",
          "type": "time",
          "timezone": null
        },
        {
          "name": "session",
          "type": "duration",
          "timezone": null
        },
        {
          "name": "tags",
          "type": "list",
          "timezone": null
        },
        {
          "name": "address",
          "type": "struct",
          "timezone": null
        },
        {
          "name": "ratings",
          "type": "map",
          "timezone": null
        },
        {
          "name": "plan",
          "type": "string",
          "timezone": null
        },
        {
          "name": "nothing",
          "type": "null",
          "timezone": null
        }
      ],
      "rows": [
        [
          "0f8fad5b-d9cb-469f-a165-70867728950e",
          "Ada Lovelace",
          36,
          "9007199254740993",
          0.5,
          true,
          "AQID",
          "123.45",
          "1815-12-10",
          "2024-01-02T03:04:05.678Z",
          "2024-01-02T03:04:05.678",
          "07:30:00.000",
          90.5,
          [
            "math",
            "poetry"
          ],
          {
            "city": "London",
            "floor": 2
          },
          [
            [
              "math",
              5
            ]
          ],
          "pro",
          null
        ],
        [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null
        ]
      ]
    }"
  `)
})
