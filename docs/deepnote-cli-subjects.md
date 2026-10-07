---
title: Answering data subject requests with the Deepnote CLI
description: Build a fingerprinted index of the people your notebooks hold data about, and answer a subject access or erasure request in minutes with deepnote subjects
noIndex: false
noContent: false
---

A subject access request names a person and asks what you hold about them. An erasure request asks
you to delete it. Both have deadlines, and both are hard to answer honestly for a notebook workspace,
because personal data in a notebook is not in a table you can query — it is in a SQL predicate, a
hardcoded list, and the output of a cell someone ran in 2023 and saved.

`deepnote subjects` makes that answerable. It indexes who appears where across a workspace you have
mirrored with [`deepnote sync`](/docs/deepnote-cli-sync), then looks people up in that index.

```bash
export DEEPNOTE_SUBJECT_SALT="$(vault read -field=salt secret/deepnote)"

deepnote subjects index ./workspace
deepnote subjects lookup jane.doe@acme-corp.io
```

## The index holds no addresses

Building a searchable list of everyone in your workspace would create a new, more convenient copy of
exactly the personal data the index exists to govern. So it does not hold one. Each person is an
HMAC-SHA256 of their address under a salt you supply, and the index stores only the fingerprint, the
domain, and where that person appears.

What the index does hold — domains, file paths, notebook names, line numbers, counts — is what makes
a request answerable, and is not personal data on its own.

### The salt is the whole security property

Email addresses are an **enumerable space**. Anyone holding an unsalted index can hash a mailing
list and read the answers straight off it. The salt is what makes the index useless on its own, so:

- **Store it in a secret manager**, not in the directory holding the index. Whoever has both has a
  list of people.
- **Keep it stable.** A new salt makes a new set of fingerprints, so an index built under one salt
  cannot be searched with another. Rotating the salt means rebuilding the index.
- **It must be at least 16 characters.** Short enough to be memorable is short enough to be guessed.

There is deliberately **no `--salt` flag**: a salt passed on the command line lands in your shell
history and in the process list of every other user on the machine. It comes from
`DEEPNOTE_SUBJECT_SALT` or from `--salt-file <path>`, both of which a secret manager can supply.

## Building the index

```bash
deepnote subjects index ./workspace --internal-domain acme.io --out ./governance/subjects.json
```

| Option                       | Description                                                   |
| ---------------------------- | ------------------------------------------------------------- |
| `[dir]`                      | Directory of synced `.deepnote` files (default: `.`)          |
| `--out <path>`               | Where to write the index (default: `.deepnote-subjects.json`) |
| `--salt-file <path>`         | Read the salt from a file instead of `DEEPNOTE_SUBJECT_SALT`  |
| `--internal-domain <domain>` | A domain belonging to your organisation (repeatable)          |
| `-o, --output <format>`      | `json` for a machine-readable summary                         |

```
Subject index → governance/subjects.json
  2 people in 5 locations, across 4 projects and 4 notebooks
  1 external, 1 internal
  ⚠ 1 person appears in 2 or more notebooks — an erasure request has to reach every one

Salt fingerprint b859e67b0d9d217f. Keep the salt itself out of this directory:
whoever holds the salt and the index together holds a list of people.
```

### What counts as a person

- **Saved cell outputs are indexed as well as code.** A block whose code reads
  `SELECT email FROM users` holds no personal data; the table it printed and saved into the file
  holds all of it. Locations in outputs are marked, because that is data at rest rather than a
  reference.
- **Plus-tags are folded in.** `jane+billing@acme.io` and `jane@acme.io` are one subject. A request
  names a person, not a mailbox alias.
- **Role accounts are not people.** `support@`, `no-reply@`, `git@` and the like are skipped.
- **Documentation placeholders are not people.** `you@example.com`, `user@yourdomain.com` and the
  RFC 2606 reserved domains are skipped.

`--internal-domain` separates colleagues from customers. When you do not pass it, the CLI guesses
using the most common domain — and only when that domain covers a clear majority. Below that it
leaves everyone unclassified and says so, because filing every customer as a colleague would be
worse than not classifying at all.

## Answering a request

```bash
deepnote subjects lookup jane.doe@acme-corp.io
```

```
Subject 0cd2396df66fd6a52a3e6f1ecacdf8fe
in the index built 2026-10-07T17:12:06.167Z from ./workspace

Found in 2 notebooks across 2 projects (3 locations, domain acme-corp.io)

  Marketing campaigns · Campaign performance
    marketing/campaigns.deepnote:4 content
  Support escalations · Open escalations
    support/escalations.deepnote:4 content
  Support escalations · Open escalations
    support/escalations.deepnote:1 output

1 location is in saved cell output — the data itself is in the file, not just a reference to it.
```

The address you look up is fingerprinted locally and never written to the output. The terminal
already knows what you typed; a transcript of requests should not accumulate into the list the index
exists to avoid.

| Option                  | Description                                                  |
| ----------------------- | ------------------------------------------------------------ |
| `<identifier>`          | The email address named in the request                       |
| `--index <path>`        | Path to the index (default: `.deepnote-subjects.json`)       |
| `--salt-file <path>`    | Read the salt from a file instead of `DEEPNOTE_SUBJECT_SALT` |
| `-o, --output <format>` | `json` for the full result                                   |

### A salt mismatch is an error, not an empty result

If the index was built under a different salt, every lookup misses. Reporting "no data held" would
be a confidently wrong answer to a legally binding question, so the command fails instead and tells
you which salt the index expects.

## Counting subjects without an index

[`deepnote audit`](/docs/deepnote-cli-audit) reports the same subject counts — how many people, how
many are spread across notebooks — without building anything. It fingerprints under a salt generated
for that run and discarded with it, so an audit report can be shared freely and cannot be read back
as a list of people, or compared against another report. Use `audit` for the overview and
`subjects index` when you need to answer requests about named people.

```bash
deepnote audit ./workspace --internal-domain acme.io
```

The corresponding finding is `pii-subject-scatter`: one person's data in more than one notebook,
which is more than one place an erasure request has to reach.

## Scope

The index covers the `.deepnote` files it was built from. Rebuild it after each sync. Data in the
warehouse itself, in projects that were never synced, or in files outside the workspace is out of
scope — and `lookup` says so with every answer, including the empty ones.

## Related

- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync) — produces the tree this
  command indexes
- [Auditing a workspace with the Deepnote CLI](/docs/deepnote-cli-audit) — integrations, data egress
  and governance findings
- [Deepnote CLI](/docs/deepnote-cli) — all commands
