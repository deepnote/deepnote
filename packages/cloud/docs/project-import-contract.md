# Project import contract (`POST /v2/projects/{projectId}/import`)

**Status:** proposed. The client half ships in `@deepnote/cloud` (`importProject`) and drives
`deepnote sync`'s push direction; this document is the server contract that half is written against.
Until the endpoint is deployed the CLI degrades gracefully (a 404/501 becomes a deferred push, not an
error), so it is safe to ship the client ahead of the server.

## Principle: import is the exact inverse of export

`GET /v2/projects/{projectId}/export` returns a **ZIP of one `.deepnote` document per notebook**,
each a full project envelope with a single notebook in `project.notebooks`, all sharing one
`metadata.modifiedAt` (see the export endpoint). Import takes **the same ZIP back**:

```
export:  project  ──►  ZIP{ notebook-a.deepnote, notebook-b.deepnote, … }
import:  ZIP{ notebook-a.deepnote (edited), … }  ──►  project
```

There is **no re-merge and no re-serialization** on either side. A document the server produced and
the client never touched must round-trip byte-for-byte. This is what makes the sync loop safe:
`export → edit → import → export` changes only what the user changed.

Because the unit is the same ZIP in both directions, the content fingerprint used for lost-update
protection is computed the same way on both sides (see [Content hash](#content-hash)), which removes
the ambiguity a single-merged-document import would have introduced.

## Request

```
POST /v2/projects/{projectId}/import
Authorization: Bearer <api-key>
Content-Type: application/zip

<ZIP body: one `.deepnote` document per notebook, the export shape>
```

| Query param              | Type    | Meaning                                                                                                                                                                                                                                                 |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseModifiedAt`         | string  | The `metadata.modifiedAt` of the export this edit was based on. Reject (409) if the project changed **structurally** since (notebook created / deleted / renamed / restored, or another import). Optional; omit to skip the structural check.           |
| `baseContentHash`        | string  | The [canonical content hash](#content-hash) of that base export. Reject (409) if the project would currently export a different hash — this catches editor block-content edits that do not move `modifiedAt`. Optional; omit to skip the content check. |
| `deleteMissingNotebooks` | boolean | Default `false`. When `true`, notebooks present in the project but absent from the ZIP are deleted. When `false`, absent notebooks are left alone.                                                                                                      |
| `force`                  | boolean | Default `false`. When `true`, skip **both** the `baseModifiedAt` and `baseContentHash` checks and import regardless of concurrent cloud edits.                                                                                                          |

The ZIP entry names are informational (the client sends back the export's filenames); **notebook
identity is the `project.notebooks[0].id` inside each document, never the filename.**

## Reconciliation semantics

Apply the union of all documents' notebooks in one transaction:

- **Match by notebook id.** A notebook whose id already exists in the project is **overwritten** in
  place — block identity is preserved (reconcile blocks by id rather than wipe-and-reinsert) so
  comment threads and deep links survive a push.
- **Unmatched notebooks are created.**
- **Missing notebooks** (in the project, not in the ZIP) are **deleted only** when
  `deleteMissingNotebooks=true`.
- **An empty ZIP (no `.deepnote` documents) is valid**: a no-op by default, a delete-every-notebook
  under `deleteMissingNotebooks` (exports of empty projects produce this, so the round-trip must
  accept it back).
- **Never applied from the documents:** the project **name**, **integrations**, and
  `settings.requirements`. `requirements.txt` in the project files is the source of truth for
  requirements; `settings.requirements` is a lossy projection. Integrations carry credentials and
  are attached via their own endpoints.
- Same-project imports should stamp the documents' ids as the notebooks' sync identity so ids
  round-trip; a foreign document (different `project.id`) should create independent notebooks and
  never overwrite by id.

## Content hash

`baseContentHash` is a hash over the **exploded documents**, not the ZIP container (archive framing —
compression, ordering, timestamps — is not part of the determinism contract). Both the CLI and the
server MUST compute it identically:

```
canonicalProjectHash(files):
  entries = files
    .map(f => sha256(f.content) is the hex sha256 of the document's UTF-8 bytes;
              line = f.filename + "\n" + sha256(f.content))
    .sort()                       # by the full line, i.e. by filename
  return sha256( entries.join("\n") )   # hex
```

`filename` is the export-allocated document filename (`slugify(notebook name) || notebook id`, deduped
within the export). The reference implementation is `canonicalProjectHash` in
`@deepnote/cli` (`packages/cli/src/commands/sync.ts`).

For lost-update checks the server re-exports the project inside the import transaction, runs the same
function, and compares to `baseContentHash`. Optionally return the post-import hash as
`project.contentHash` in the response so a client can chain the next push without re-exporting.

## Response

`200 OK`:

```jsonc
{
  "project": {
    "id": "…",
    "modifiedAt": "2026-01-09T00:00:00.000Z",  // post-import metadata.modifiedAt
    "contentHash": "…"                          // optional: post-import canonical hash
  },
  "notebooks": [
    { "id": "…", "name": "Main", "action": "created" | "overwritten" | "restored" | "deleted" }
  ]
}
```

`notebooks[].id` should be the **document-facing id** (the id the pushed document used, which future
exports will emit), so a client can correlate the response with what it sent.

### Errors

| Status | When                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed request (bad query params).                                                                                                                                           |
| 401    | Missing/invalid API key.                                                                                                                                                        |
| 403    | No write access, or the plan's notebook limit would be exceeded.                                                                                                                |
| 404    | Project not found — **also the "endpoint not deployed" signal the client degrades on.**                                                                                         |
| 409    | Project changed since `baseModifiedAt`/`baseContentHash` (unless `force`), or is suspended.                                                                                     |
| 413    | ZIP (or a document) over the server's size limit. Keep symmetric with the export ceiling so a project that exports cannot fail to import.                                       |
| 422    | A document is malformed, contains an unsupported block type, or violates naming/structure rules (duplicate notebook or block ids, name collisions). Client error — never a 500. |
| 429    | Rate limited (`Retry-After`).                                                                                                                                                   |

## Working-directory files (already available)

The file half of push does **not** need new endpoints — it uses the public API as-is:

- `POST /v2/files` (multipart `projectId`, `path`, `file`) — upload. **Generates a unique path when
  `path` already exists; it does not overwrite.** To replace a file, `DELETE` it first.
- `DELETE /v2/files?projectId=&path=` — delete.

`deepnote sync --all-files` uploads changed local files on push by delete-then-upload (last-write-wins;
the files surface has no content hash or staleness check). Files removed locally are **not** deleted
in the cloud — too destructive to infer. See `uploadProjectFile` / `deleteProjectFile` in
`@deepnote/cloud`.
