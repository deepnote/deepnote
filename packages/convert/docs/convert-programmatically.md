## Programmatic usage

You can use the conversion function programmatically in Node.js or TypeScript applications.

## Basic example

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

await convertIpynbFilesToDeepnoteFile(["path/to/notebook.ipynb"], {
  outputPath: "output.deepnote",
  projectName: "My Project",
});
```

### Convert multiple notebooks

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

// Convert multiple notebooks into a single project
await convertIpynbFilesToDeepnoteFile(
  [
    "notebooks/data-cleaning.ipynb",
    "notebooks/analysis.ipynb",
    "notebooks/visualization.ipynb",
  ],
  {
    outputPath: "projects/data-pipeline.deepnote",
    projectName: "Data Pipeline",
  },
);
```

## With error handling

```typescript
import { convertIpynbFilesToDeepnoteFile } from "@deepnote/convert";

try {
  await convertIpynbFilesToDeepnoteFile(["notebook.ipynb"], {
    outputPath: "output.deepnote",
    projectName: "My Analysis",
  });
  console.log("Conversion successful!");
} catch (error) {
  console.error("Conversion failed:", error.message);
}
```

## API reference

### `convertIpynbFilesToDeepnoteFile(inputFilePaths, options)`

Converts Jupyter Notebook files to a Deepnote project file.

**Parameters:**

- `inputFilePaths` (string[]): Array of paths to `.ipynb` files to convert
- `options` (ConvertIpynbFilesToDeepnoteFileOptions):
  - `outputPath` (string): Path where the `.deepnote` file will be saved
  - `projectName` (string): Name for the Deepnote project

**Returns:** Promise<void>

**Throws:** Error if file reading or parsing fails
