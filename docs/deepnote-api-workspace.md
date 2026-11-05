---
title: Managing projects and integrations with the Deepnote API
description: Export and import Deepnote projects as .deepnote files, create and attach integrations, see where an integration is used, and search a workspace through the API
noIndex: false
noContent: false
---

The API covers the parts of a workspace that teams usually manage by hand: projects, their
notebooks, the integrations they connect to, and the files they hold. Scripting them makes backups,
migrations and credential rotation repeatable instead of a checklist.

All examples use `$DEEPNOTE_TOKEN`; see [Authentication](/docs/deepnote-api#authentication).

## Export and import projects

`GET /v2/projects/{projectId}/export` returns a ZIP with one [`.deepnote` file](/docs/deepnote-format)
per notebook, as readable YAML that diffs well in Git. Outputs and execution metadata are left out.

```bash
curl -s "https://api.deepnote.com/v2/projects/$PROJECT_ID/export" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" -o project.zip
```

`POST /v2/projects/{projectId}/import` applies such a ZIP back to the project. Before you edit the
export, note two values from it so the import can refuse to overwrite changes made in the meantime:
`metadata.modifiedAt`, which is the same in every file, and a content hash of the files. An empty
export has no files to read `modifiedAt` from, so the import then sends only the hash:

```bash
mkdir -p base && { unzip -q project.zip -d base || [ $? -eq 1 ]; } # 1: warnings, e.g. an empty ZIP
shopt -s nullglob # an empty export hashes as an empty set
docs=(base/*.deepnote)
BASE_MODIFIED_AT=""
if ((${#docs[@]})); then
  BASE_MODIFIED_AT=$(awk '/^  modifiedAt:/ { gsub(/["\047]/, "", $2); print $2; exit }' "${docs[@]}")
fi
BASE_CONTENT_HASH=$(cd base && LC_ALL=C && printf '%s' "$(for f in *.deepnote; do
  printf '%s\n%s\n' "$f" "$(shasum -a 256 < "$f" | cut -d' ' -f1)"; done)" | shasum -a 256 | cut -d' ' -f1)
QUERY="baseContentHash=$BASE_CONTENT_HASH${BASE_MODIFIED_AT:+&baseModifiedAt=$BASE_MODIFIED_AT}"
```

Edit the files, zip them again and import:

```bash
curl -s -X POST "https://api.deepnote.com/v2/projects/$PROJECT_ID/import?$QUERY" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @project.zip
```

- **It is safe to undo.** Before changing anything, Deepnote saves the project's current state to
  [version history](/docs/history), so you can restore the notebooks as they were.
- **It reconciles, it does not replace.** Notebooks are matched by id. Notebooks missing from the
  archive are left alone unless you add `deleteMissingNotebooks=true`, so you can import a single
  notebook. Imported notebooks lose their outputs, since the archive has none.
- **It will not overwrite someone else's work.** With `baseModifiedAt` the import returns `409` if
  notebooks were added, removed, renamed or restored since your export; with `baseContentHash` it
  also does so if any block's content changed. Pass both. The hash is the SHA-256 of one
  `<filename>` and `<SHA-256 of the file>` line pair per exported file, sorted by filename and
  joined with newlines, as the commands above compute. `force=true` skips both checks.
  [`deepnote sync`](/docs/deepnote-cli-sync) does all of this for you.
- Python requirements are not part of the archive.

What this enables:

- **Backups.** A nightly job that exports every project from `GET /v2/projects` into Git or object
  storage gives you a readable history of every notebook.
- **Notebooks in Git, edited anywhere.** Export, edit the `.deepnote` files in your editor or with an
  AI agent, check them with `deepnote lint`, and import. [`deepnote sync`](/docs/deepnote-cli-sync)
  does exactly this for a whole workspace.
- **Review before it lands.** Import from CI after a pull request is merged, so changes to important
  notebooks go through code review.

`POST /v2/projects` creates an empty project; it does not take files. To create a project from a
`.deepnote` file, upload it with [`deepnote open`](/docs/deepnote-cli).

## Integrations

Create an integration from a script, for example from credentials kept in your secret manager:

```bash
curl -s -X POST https://api.deepnote.com/v2/integrations \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Analytics warehouse",
    "type": "pgsql",
    "metadata": {
      "host": "db.example.com",
      "port": "5432",
      "database": "analytics",
      "user": "deepnote",
      "password": "'"$DB_PASSWORD"'"
    }
  }'
```

`metadata` holds the same connection settings as the integration form in the app. Then connect it to
the projects that need it:

```bash
curl -s -X POST "https://api.deepnote.com/v2/integrations/$INTEGRATION_ID/attach" \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "'"$PROJECT_ID"'" }'
```

`detach` takes the same body.

### Find where an integration is used

Before you rotate a password, retire a database or change a schema, see what depends on it:

| Request                                                | Returns                                    |
| ------------------------------------------------------ | ------------------------------------------ |
| `GET /v2/integrations/{integrationId}/usages/project`  | Projects the integration is attached to    |
| `GET /v2/integrations/{integrationId}/usages/notebook` | Notebooks that use it, with their projects |
| `GET /v2/integrations/{integrationId}/usages/block`    | The individual blocks that query it        |

Add `projectId` to narrow the results to one project. `GET /v2/integrations/{integrationId}` also
lists the tables the integration exposes.

## Search the workspace

`GET /v2/search?q=…` searches projects, notebooks, blocks and integrations at once, and returns
matching code and SQL with the lines that matched:

```bash
curl -s -G https://api.deepnote.com/v2/search \
  -H "Authorization: Bearer $DEEPNOTE_TOKEN" \
  --data-urlencode "q=orders_v1" \
  --data-urlencode "types=blocks"
```

Use it to find every query that still reads a table you are about to drop, or to give an internal
tool or AI agent a way to find the right notebook.

## Files and members

- **Project files:** `GET /v2/files/content` reads a text file, `GET /v2/files/download` downloads
  any file, and `POST /v2/files`, `POST /v2/files/copy` and `DELETE /v2/files` create, copy between
  projects and delete them.
- **Members:** `GET /v2/members` lists the workspace's members and their access levels, for example
  to audit who has access.

See the [API reference](/docs/api-reference) for their parameters.

## Related

- [Deepnote API](/docs/deepnote-api) and the [API reference](/docs/api-reference)
- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync)
- [Integrations](/docs/integrations) and [Deepnote file format](/docs/deepnote-format)
