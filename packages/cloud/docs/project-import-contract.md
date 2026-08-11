# Project import contract (`POST /v2/projects/{projectId}/import`)

**Status:** implemented. The client ships in `@deepnote/cloud` (`importProject`) and drives
`deepnote sync`'s push direction. This document describes the deployed server contract.

## Principle: import is the exact inverse of export

`GET /v2/projects/{projectId}/export` returns a **ZIP of one `.deepnote` document per notebook**,
each a full project envelope with a single notebook in `project.notebooks`, all sharing one
`metadata.modifiedAt` (see the export endpoint). Import takes **the same ZIP back**:

```text
export:  project  ──►  ZIP{ notebook-a.deepnote, notebook-b.deepnote, … }
import:  ZIP{ notebook-a.deepnote (edited), … }  ──►  project
```

The client does **no re-merge and no re-serialization**: it returns the edited documents as ZIP
entries. The server reconciles them within a transaction and a subsequent export returns the canonical
post-import representation. That re-export is important because imports clear execution state and
may assign persistent identities to newly created notebooks.

Because the unit is the same ZIP in both directions, the content fingerprint used for lost-update
protection is computed the same way on both sides (see [Content hash](#content-hash)), which removes
the ambiguity a single-merged-document import would have introduced.

## Request

```http
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

Every ZIP entry must be a non-empty `.deepnote` file at the archive root and contain exactly one
notebook. ZIP entry names are informational (the client sends back the export's filenames);
**notebook identity is the `project.notebooks[0].id` inside each document, never the filename.**

## Reconciliation semantics

Before applying changes, Deepnote creates a version-history snapshot of the current notebook state.
It then applies the union of all documents' notebooks in one transaction:

- **Match by notebook id.** A notebook whose id already exists in the project is **overwritten** in
  place — block identity is preserved (reconcile blocks by id rather than wipe-and-reinsert) so
  comment threads and deep links survive a push. Imported notebooks have their block outputs and
  execution state cleared.
- **Unmatched notebooks are created.**
- **Missing notebooks** (in the project, not in the ZIP) are **deleted only** when
  `deleteMissingNotebooks=true`.
- **An empty ZIP (no `.deepnote` documents) is valid**: it imports no notebooks by default and
  deletes every notebook under `deleteMissingNotebooks` (exports of empty projects produce this, so
  the round-trip must accept it back). With no documents, project name and integrations are
  unchanged.
- **Every document must belong to the target project.** A different `project.id` is rejected rather
  than treated as a request to clone notebooks into the target project.
- **All documents must carry the same `project.name`.** The shared name is applied to the target
  project. A changed name requires project rename permission.
- **All documents must carry the same integration attachment set** (compared by integration id,
  independent of order). If `project.integrations` is absent, existing attachments are unchanged.
  If present, the project is reconciled to the declared attachments: `[]` detaches all and a
  populated list attaches those integrations and detaches omitted ones. Referenced integrations
  must be available to the project; credentials are never imported from the documents.
- **Never applied from the documents:** `settings.requirements`. `requirements.txt` in the
  project's files is the source of truth; `settings.requirements` is a lossy projection.
- Same-project imports stamp document notebook ids as the notebooks' sync identity so ids round-trip.

## Content hash

`baseContentHash` is a hash over the **exploded documents**, not the ZIP container (archive framing —
compression, ordering, timestamps — is not part of the determinism contract). Both the CLI and the
server MUST compute it identically:

```text
canonicalProjectHash(files):
  entries = files
    .map(f => sha256(f.content) is the hex sha256 of the document's UTF-8 bytes;
              line = f.filename + "\n" + sha256(f.content))
    .sort()                       # by filename, using ordinal UTF-16 code-unit order
  return sha256( entries.join("\n") )   # hex
```

JavaScript's default string `.sort()` uses locale-independent UTF-16 code-unit order.
Locale-sensitive collation such as `localeCompare` must not be used.

`filename` is the export-allocated document filename (`slugify(notebook name) || notebook id`, deduped
within the export). The reference implementation is `canonicalProjectHash` in
`@deepnote/cli` (`packages/cli/src/commands/sync.ts`).

For lost-update checks the server re-exports the project inside the import transaction, runs the same
function, and compares to `baseContentHash`. The response returns the post-import hash as
`project.contentHash` so a client can chain the next push without re-exporting.

## Response

`200 OK`:

```jsonc
{
  "project": {
    "id": "…",
    "modifiedAt": "2026-01-09T00:00:00.000Z",  // required post-import metadata.modifiedAt
    "contentHash": "…"                          // required post-import canonical hash
  },
  "notebooks": [
    { "id": "…", "name": "Main", "action": "created" | "overwritten" | "restored" | "deleted" }
  ]
}
```

`notebooks[].id` should be the **document-facing id** (the id the pushed document used, which future
exports will emit), so a client can correlate the response with what it sent.

### Errors

| Status | When                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed request (bad query params or a content type other than `application/zip`).                                                                                |
| 401    | Missing/invalid API key.                                                                                                                                            |
| 403    | No write access, missing rename permission for a changed project name, or the plan's notebook limit would be exceeded.                                              |
| 404    | Project not found.                                                                                                                                                  |
| 409    | Project changed since `baseModifiedAt`/`baseContentHash` (unless `force`), or is suspended.                                                                         |
| 413    | ZIP (or a document) over the server's size limit. Keep symmetric with the export ceiling so a project that exports cannot fail to import.                           |
| 422    | The archive/document is malformed, targets another project, contains inconsistent project metadata or unavailable integrations, or violates naming/structure rules. |
| 429    | Rate limited (`Retry-After`).                                                                                                                                       |

## Working-directory files (already available)

The file half of push does **not** need new endpoints — it uses the public API as-is:

- `POST /v2/files` (multipart `projectId`, `path`, `file`) — upload. **Generates a unique path when
  `path` already exists; it does not overwrite.** To replace a file, `DELETE` it first.
- `DELETE /v2/files?projectId=&path=` — delete.

`deepnote sync --all-files` uploads changed local files on push by delete-then-upload (last-write-wins;
the files surface has no content hash or staleness check). Files removed locally are **not** deleted
in the cloud — too destructive to infer. See `uploadProjectFile` / `deleteProjectFile` in
`@deepnote/cloud`.
