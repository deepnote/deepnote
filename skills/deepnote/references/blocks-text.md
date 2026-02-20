# Text Blocks

> Common block fields (`id`, `blockGroup`, `type`, `content`, `sortingKey`, `metadata`) are described in [SKILL.md](../SKILL.md).

## Markdown Block (`markdown`)

Rich text documentation using Markdown syntax.

**Metadata fields:**

| Field                  | Type     | Description         |
| ---------------------- | -------- | ------------------- |
| `deepnote_cell_height` | `number` | Cell display height |

```yaml
- id: e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
  blockGroup: f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3
  type: markdown
  content: |
    ## Data Analysis

    This notebook explores the **customer dataset** and generates insights.
  sortingKey: a2
  metadata: {}
```

## Text Cell Blocks

Structured text blocks for headings, paragraphs, lists, and callouts.

### Common Text Cell Metadata

| Field             | Type      | Description                   |
| ----------------- | --------- | ----------------------------- |
| `is_collapsed`    | `boolean` | Whether the cell is collapsed |
| `formattedRanges` | `array`   | Inline formatting ranges      |

### Heading Blocks (`text-cell-h1`, `text-cell-h2`, `text-cell-h3`)

```yaml
- id: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4
  blockGroup: b1c2d3e4f5a6b1c2d3e4f5a6b1c2d3e4
  type: text-cell-h1
  content: Main Title
  sortingKey: a0
  metadata: {}
```

### Paragraph Block (`text-cell-p`)

```yaml
- id: c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6
  blockGroup: d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1
  type: text-cell-p
  content: This is a paragraph of explanatory text.
  sortingKey: a1
  metadata: {}
```

### Bullet Block (`text-cell-bullet`)

```yaml
- id: e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
  blockGroup: f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3
  type: text-cell-bullet
  content: First bullet point
  sortingKey: a2
  metadata: {}
```

### Todo Block (`text-cell-todo`)

**Additional metadata:**

| Field     | Type      | Description                        |
| --------- | --------- | ---------------------------------- |
| `checked` | `boolean` | Whether the todo item is completed |

```yaml
- id: a2b3c4d5e6f7a2b3c4d5e6f7a2b3c4d5
  blockGroup: b2c3d4e5f6a7b2c3d4e5f6a7b2c3d4e5
  type: text-cell-todo
  content: Clean up the dataset
  sortingKey: a3
  metadata:
    checked: false
```

### Callout Block (`text-cell-callout`)

**Additional metadata:**

| Field   | Type                                                 | Description   |
| ------- | ---------------------------------------------------- | ------------- |
| `color` | `"blue" \| "green" \| "yellow" \| "red" \| "purple"` | Callout color |

```yaml
- id: c4d5e6f7a8b9c4d5e6f7a8b9c4d5e6f7
  blockGroup: d5e6f7a8b9c0d5e6f7a8b9c0d5e6f7a8
  type: text-cell-callout
  content: Important note about data quality.
  sortingKey: a4
  metadata:
    color: yellow
```
