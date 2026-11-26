# @deepnote/stored-dataframes

Node.js library for serving one page of a dataframe that deepnote-toolkit's `store_dataframe(df, name)`
stored, as JSON. It holds the storage layout, the manifest format, the page parameters and page
planning, the error-to-HTTP-status mapping, and the Arrow-to-JSON value encoder. It does no file
I/O: the caller reads the manifest, and reads the frame file with apache-arrow.

This package is Node-only. It uses `Buffer`, `node:assert` and `node:timers/promises`, so do not
import it from browser bundles. It ships ESM and CJS builds and runs on Node.js 22.14.0 or later.

## Installation

```bash
npm install @deepnote/stored-dataframes apache-arrow
```

`apache-arrow` ^21.2.0 is a peer dependency. The encoder checks values read from the caller's record
batches with `instanceof` against apache-arrow's classes, so the caller and this package must
resolve to the same copy of apache-arrow.

The package registers no compression codec in apache-arrow's `compressionRegistry`. Stored frames
are usually zstd-compressed, so register a zstd codec before reading one, as the usage example does.
`zlib.zstdDecompressSync` needs Node.js 22.15.0 or later.

## Stored frames

Each frame is a directory, relative to the storage root, the folder deepnote-toolkit stores frames
under. `dataframeDirectory` returns it, or `null` for a name or ID outside its pattern.

| Frame | Directory                                      | Pattern                                                 |
| ----- | ---------------------------------------------- | ------------------------------------------------------- |
| Named | `deepnote_dataframes/<name>/`                  | `<name>` matches `^[A-Za-z0-9_-]{1,128}$`               |
| Block | `.deepnote/dataframes/<notebookId>/<blockId>/` | `<notebookId>` and `<blockId>` match `^[A-Za-z0-9_-]+$` |

The directory holds `manifest.json` and the frame file it names:

```json
{
  "version": 1,
  "file": "4f988928-3050-43ab-ab95-15554633d002.arrow",
  "written_at": "2026-11-25T14:22:21Z",
  "rows": 3,
  "batch_rows": [3],
  "toolkit_version": "2.9.1"
}
```

- `file` is a lowercase UUID followed by `.arrow`. Without `.arrow`, it is the page's `referenceId`.
- `rows` is the frame's row count, an integer ≥ 0.
- `batch_rows` lists the row count of each record batch in file order, each an integer ≥ 0. The
  entries add up to `rows`.
- Any other key, such as `version`, `written_at` or `toolkit_version`, is ignored.

deepnote-toolkit refuses to write a manifest larger than 64 KiB, the value of `MANIFEST_MAX_BYTES`.
`parseManifest` does not check the size of its input.

The frame file is in the Arrow IPC file format, with one record batch per `batch_rows` entry.

## Usage

Answer a request for one page of the named frame `name` stored under `storageRoot`. `query` is the
request's query string as an object; the result is the HTTP status and JSON body. An lz4-compressed
frame is answered with 422 through `UnservablePageError.lz4Compressed()`.

```ts
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import {
  CompressionType,
  compressionRegistry,
  type RecordBatch,
  RecordBatchReader,
} from "apache-arrow";
import {
  type DataframePage,
  type DataframePageRequest,
  DataframeNotFoundError,
  DataframePageError,
  DataframePageRequestError,
  dataframeDirectory,
  dataframePageErrorResponse,
  dataframePageQuerySchema,
  describeColumns,
  encodeRows,
  InvalidArrowFileError,
  MANIFEST_FILE_NAME,
  parseManifest,
  planDataframePage,
  slicePageColumns,
  UnservablePageError,
} from "@deepnote/stored-dataframes";

compressionRegistry.set(CompressionType.ZSTD, {
  decode: (bytes) => zlib.zstdDecompressSync(bytes),
});
compressionRegistry.set(CompressionType.LZ4_FRAME, {
  decode: () => {
    throw UnservablePageError.lz4Compressed();
  },
});

export async function answerDataframePage(
  storageRoot: string,
  name: string,
  query: unknown,
): Promise<{ status: number; body: DataframePage | { message: string } }> {
  try {
    const request = dataframePageQuerySchema.safeParse(query);
    if (!request.success) {
      throw new DataframePageRequestError(
        request.error.issues.map((issue) => issue.message).join("; "),
      );
    }
    const page = await readPage(storageRoot, name, request.data);
    return { status: 200, body: page };
  } catch (error) {
    if (error instanceof DataframePageError) {
      return dataframePageErrorResponse(error);
    }
    throw error;
  }
}

async function readPage(
  storageRoot: string,
  name: string,
  request: DataframePageRequest,
): Promise<DataframePage> {
  const directory = dataframeDirectory({ type: "named", name });
  if (directory === null) {
    throw new DataframePageRequestError("Invalid dataframe name");
  }
  const frameDirectory = path.join(storageRoot, directory);
  const manifest = parseManifest(
    await notFoundIfMissing(
      readFile(path.join(frameDirectory, MANIFEST_FILE_NAME), "utf8"),
    ),
  );
  if (manifest === null) {
    throw new DataframeNotFoundError();
  }
  const plan = planDataframePage(manifest, request);

  const handle = await notFoundIfMissing(
    open(path.join(frameDirectory, manifest.file)),
  );
  try {
    const reader = await RecordBatchReader.from(handle);
    if (!reader.isFile()) {
      throw InvalidArrowFileError.undecodable("not an Arrow IPC file");
    }
    await reader.open();
    if (reader.numRecordBatches !== manifest.batchRows.length) {
      throw InvalidArrowFileError.batchCountMismatch({
        listed: manifest.batchRows.length,
        held: reader.numRecordBatches,
      });
    }
    const batches: RecordBatch[] = [];
    for (const { index } of plan.batches) {
      const batch = await reader.readRecordBatch(index);
      if (!batch) {
        throw InvalidArrowFileError.undecodable(`batch ${index} is missing`);
      }
      batches.push(batch);
    }
    const pageColumns = slicePageColumns(reader.schema, batches, plan.batches);
    const columns = describeColumns(reader.schema);
    return {
      referenceId: manifest.referenceId,
      rowCount: manifest.rows,
      columnCount: columns.length,
      pageIndex: request.pageIndex,
      pageSize: request.pageSize,
      pageCount: plan.pageCount,
      columns,
      rows: await encodeRows(pageColumns, plan.rows),
    };
  } finally {
    await handle.close();
  }
}

async function notFoundIfMissing<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new DataframeNotFoundError();
    }
    throw error;
  }
}
```

## API reference

Contracts beyond one line are documented on the exported symbols.

| Export                                                     | Description                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataframeDirectory(source)`                               | The directory of a `DataframeSource` as a POSIX path relative to the storage root, or `null` when its name or an ID fails its pattern.                                                                                                                                |
| `DataframeSource`                                          | Type: `{ type: 'named'; name }` or `{ type: 'block'; notebookId; blockId }`.                                                                                                                                                                                          |
| `DATAFRAME_NAME_PATTERN`                                   | `/^[A-Za-z0-9_-]{1,128}$/`, the pattern a named frame's name matches.                                                                                                                                                                                                 |
| `NAMED_DATAFRAMES_DIRECTORY`, `BLOCK_DATAFRAMES_DIRECTORY` | `'deepnote_dataframes'` and `'.deepnote/dataframes'`, relative to the storage root.                                                                                                                                                                                   |
| `MANIFEST_FILE_NAME`, `FRAME_EXTENSION`                    | `'manifest.json'` and `'.arrow'`.                                                                                                                                                                                                                                     |
| `MANIFEST_MAX_BYTES`                                       | `65536` (64 KiB), the largest manifest a reader needs to accept. The package does not enforce it.                                                                                                                                                                     |
| `STORE_DATAFRAME_METADATA_KEY`                             | `'deepnote_store_dataframe'`, a block metadata key. `true` marks a block whose dataframe is stored as a block frame.                                                                                                                                                  |
| `parseManifest(text)`                                      | The `Manifest` in `text`, or `null` when `text` is not JSON or not a valid manifest. Never throws.                                                                                                                                                                    |
| `manifestSchema`                                           | Zod schema that validates the manifest JSON and transforms it into a `Manifest`.                                                                                                                                                                                      |
| `Manifest`                                                 | Type: `{ file, referenceId, rows, batchRows }`.                                                                                                                                                                                                                       |
| `dataframePageQuerySchema`                                 | Zod schema for the page parameters of an HTTP query: `pageIndex` (integer ≥ 0, default `0`) and `pageSize` (integer 1–1000, default `10`), coerced from strings. Any other key is rejected.                                                                           |
| `dataframePageRequestSchema`, `DataframePageRequest`       | Zod schema and type of a page request given as numbers, with both parameters required.                                                                                                                                                                                |
| `MAX_DATAFRAME_PAGE_SIZE`, `DEFAULT_DATAFRAME_PAGE_SIZE`   | `1000` and `10`.                                                                                                                                                                                                                                                      |
| `planDataframePage(manifest, request)`                     | Returns the `DataframePagePlan` for a request that `dataframePageQuerySchema` or `dataframePageRequestSchema` accepted. Throws `DataframePageRequestError` when `pageIndex` is past the last page.                                                                    |
| `DataframePagePlan`                                        | Type: `{ pageCount, rows, batches }`, where `rows` is the page's row count and `batches` the `PageBatch` entries it takes rows from, in file order.                                                                                                                   |
| `PageBatch`                                                | Type: `{ index, rows, beginInBatch, endInBatch }`: the record batch index, the batch's full row count, and the page's rows in it, `[beginInBatch, endInBatch)`.                                                                                                       |
| `slicePageColumns(schema, batches, pageBatches)`           | Joins the page's rows of `batches`, the record batches `pageBatches` lists, in its order, into one `ArrowPageColumn` per field of `schema`. Pass the reader's schema, not `batch.schema`. Throws `InvalidArrowFileError` when the batches do not match `pageBatches`. |
| `describeColumns(schema)`                                  | One `DataframeColumn` per field. Throws `UnsupportedArrowTypeError` for a type `encodeRows` cannot encode.                                                                                                                                                            |
| `encodeRows(columns, rowCount, hooks?)`                    | Encodes `rowCount` rows of `columns`, which `describeColumns` must accept, as `DataframeRow` values, yielding to the event loop as it goes.                                                                                                                           |
| `EncodeRowsHooks`                                          | Type: `{ chargeJsonBytes?, chargeValues? }`, the caller's budget for the rows' JSON bytes and values, charged before each allocation. A hook refuses a page by throwing, normally an `UnservablePageError`.                                                           |
| `ArrowPageColumn`                                          | Type: `{ field, vector }`, one column of a page.                                                                                                                                                                                                                      |
| `DataframePage`                                            | Type: the page response body, with the keys `referenceId`, `rowCount`, `columnCount`, `pageIndex`, `pageSize`, `pageCount`, `columns` and `rows`, in that order.                                                                                                      |
| `DataframeColumn`                                          | Type: `{ name, type, timezone }`, an entry of a page's `columns`.                                                                                                                                                                                                     |
| `DATAFRAME_COLUMN_TYPES`, `DataframeColumnType`            | The values of `DataframeColumn.type`.                                                                                                                                                                                                                                 |
| `DataframeRow`, `JsonValue`                                | Types: a row holds one JSON value per column, in column order.                                                                                                                                                                                                        |
| `dataframePageErrorResponse(error)`                        | The `{ status, body: { message } }` that answers a `DataframePageError`; see [Errors](#errors).                                                                                                                                                                       |
| `DataframePageError`, `DataframePageErrorStatus`           | Abstract base class of the errors below, with the `status` (`400`, `404` or `422`) that answers it.                                                                                                                                                                   |
| `DataframeNotFoundError`                                   | The frame does not exist.                                                                                                                                                                                                                                             |
| `DATAFRAME_NOT_FOUND_MESSAGE`                              | `'Dataframe not found'`.                                                                                                                                                                                                                                              |
| `DataframePageRequestError`                                | The page request is invalid.                                                                                                                                                                                                                                          |
| `InvalidArrowFileError`                                    | The manifest or the frame file is not a valid frame. `reason` names the check; static factories build this package's reasons, and the public constructor or a subclass adds others.                                                                                   |
| `UnservablePageError`                                      | The frame or the page cannot be served. `reason`, factories and constructor as for `InvalidArrowFileError`.                                                                                                                                                           |
| `UnsupportedArrowTypeError`                                | An `UnservablePageError` for a column type `encodeRows` cannot encode.                                                                                                                                                                                                |

## Errors

`dataframePageErrorResponse` answers each `DataframePageError` with its `status` and a body of
`{ "message": <message> }`:

| Error                                                                           | Status | `message`                                        |
| ------------------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| `DataframePageRequestError`                                                     | 400    | The error's message                              |
| `DataframeNotFoundError`                                                        | 404    | `Dataframe not found`                            |
| `InvalidArrowFileError` and its subclasses                                      | 404    | `Dataframe not found`, never the error's message |
| `UnservablePageError` and its subclasses, including `UnsupportedArrowTypeError` | 422    | The error's message                              |

`dataframePageErrorResponse` takes only a `DataframePageError`. Any other error, such as a failed
file read or a hook's own error that `encodeRows` passes through, is the caller's to handle.
