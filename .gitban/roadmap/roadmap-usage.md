# Roadmap Usage Guide

This guide explains how to use the roadmap MCP tools for hierarchical project planning.

## Quick Start

Three common operations using path-based addressing:

```python
# Browse and read the roadmap structure -- one bounded level at a time
read_roadmap()                          # milestones (+ document envelope under `node`)
read_roadmap(path="m1")                 # m1's own fields + its stories
read_roadmap(path="m1/s1")              # s1's own fields + its projects
read_roadmap(path="m1/s1/infra-core")  # a project + its features

# Update content (partial updates supported)
upsert_roadmap({"status": "done"}, path="m1/s1/infra-core/terraform-setup")
```

## Path Format

Paths use `/` as separator. Depth determines scope:

| Depth | Example | Scope | Target |
|-------|---------|-------|--------|
| 1 | `"m1"` | milestone | Milestone v1 |
| 2 | `"m1/s1"` | story | Story m1 in v1 |
| 3 | `"m1/s1/infra-core"` | project | Project infra-core |
| 4 | `"m1/s1/infra-core/terraform-setup"` | feature | Feature terraform-setup |

Paths work with `read_roadmap`, `upsert_roadmap`, and `delete_from_roadmap`.

## Hierarchy

```
milestones (v1, v2, ...)
  └─ stories (m1, m2, ...)
      └─ projects (groups of related work)
          └─ features (specific deliverables)
```

Each level has a status: `todo`, `in_progress`, or `done`.

## Merge Semantics

`upsert_roadmap` uses deep-merge for updates. Only the fields you provide are changed;
everything else (including child collections) is preserved.

```python
# Update just the status — title, description, features all preserved
upsert_roadmap({"status": "done"}, path="m1/s1/infra-core")

# Add a new field — existing fields untouched
upsert_roadmap({"priority": "critical"}, path="m1/s1/infra-core")

# Create new content — provide all required fields
upsert_roadmap({
    "id": "m2",
    "title": "Release 2.0",
    "status": "todo",
    "stories": {}
}, path="m2")
```

When creating new items, fetch `roadmap://schema` to see required fields per scope.

## Browsing & Navigation

`read_roadmap` is the single bounded read surface. It returns the addressed node's
own fields plus one level of children -- never a recursive dump -- so drill down a
level at a time. Each call returns `{node, children, node_counts, pagination}`. Pass
`fields=[...]` to project each child down to just those fields (anchors `id`/`title`
are always included); `fields=None` (the default) returns all of each child's metadata.

```python
# Step 1: See what milestones exist
read_roadmap()
# → children: [{id: "m1", title: "Initial Release", ...}], node_counts: {children: 3, ...}

# Step 2: Drill into a milestone (its stories)
read_roadmap(path="m1")
# → children: [{id: "s1", title: "Core Infrastructure", ...}]

# Step 3: See projects in a story, projecting only the fields you need
read_roadmap(path="m1/s1", fields=["status", "priority"])

# Step 4: Read a project and its features
read_roadmap(path="m1/s1/infra-core")
```

Use `search_roadmap` for text search across the roadmap with breadcrumb paths in results.

### Pagination

`read_roadmap` paginates the `children` list and is bounded by design -- there is no
unbounded opt-out. The response carries a `pagination` envelope
(`{total, offset, limit, returned, has_more, next_offset}`); loop until `has_more` is
false:

```python
page = read_roadmap(path="m1", limit=50)        # first 50 children
while page["pagination"]["has_more"]:
    page = read_roadmap(path="m1", limit=50,
                        offset=page["pagination"]["next_offset"])
```

## Error Recovery

When a tool returns an error, it includes the available siblings to help you navigate:

```
Error: Milestone 'm9' not found
Suggestion: Available milestones: v1, v2. Use read_roadmap(path='...') to browse.
```

Common recovery patterns:

| Error | Recovery |
|-------|----------|
| "Milestone 'X' not found" | Check available milestones with `read_roadmap()` |
| "Story 'X' not found" | Check stories with `read_roadmap(path="m1")` |
| "Schema validation failed" | Fetch `roadmap://schema` and check required fields |
| "roadmap.yaml not found" | Run `setup()` to create roadmap infrastructure |

## Deleting Content

Deletion requires `confirm=True` and tracks cascade effects:

```python
# Delete a single feature
delete_from_roadmap(path="m1/s1/infra-core/terraform-setup", confirm=True)

# Delete a project (cascades to all its features)
delete_from_roadmap(path="m1/s1/infra-core", confirm=True)
# → cascade_deleted: {features: 6, feature_ids: [...]}
```

## Addressing

`read_roadmap`, `upsert_roadmap`, and `delete_from_roadmap` are all addressed by a
single `path` string (the older `scope` + `*_id` parameter style has been removed):

```python
read_roadmap(path="m1/s1")
upsert_roadmap(content, path="m1/s1/infra-core")
delete_from_roadmap(path="m1/s1/infra-core", confirm=True)
```

## MCP Resources (Read-Only)

- **`roadmap://roadmap-schema`** — JSON schema for validation rules
- **`roadmap://roadmap-usage-guide`** — This document
- **`roadmap://current-roadmap`** — Current roadmap.yaml content

## Release History

The roadmap no longer carries an embedded changelog. Record release history in
the project's `CHANGELOG.md`, and annotate completed roadmap nodes with
`released_as` metadata (the package version a node shipped in) via
`upsert_roadmap`. This keeps a single, GitHub-visible source of truth for what
shipped when.
