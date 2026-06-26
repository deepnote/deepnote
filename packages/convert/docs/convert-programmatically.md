# Converting Jupyter notebooks programmatically

You can use the conversion function programmatically in Node.js or TypeScript applications. Each call converts one `.ipynb` file into one single-notebook `.deepnote` file.

## Basic example

```typescript
import { convertIpynbFileToDeepnoteFile } from "@deepnote/convert";

await convertIpynbFileToDeepnoteFile("path/to/notebook.ipynb", {
  outputPath: "notebook.deepnote",
  projectName: "My Project",
});
```

## Convert several notebooks

Convert each notebook to its own `.deepnote` file. Pass a shared `projectId` so the resulting files belong to the same project:

```typescript
import { randomUUID } from "node:crypto";
import { convertIpynbFileToDeepnoteFile } from "@deepnote/convert";

const projectId = randomUUID();

for (const file of [
  "data-cleaning.ipynb",
  "analysis.ipynb",
  "visualization.ipynb",
]) {
  await convertIpynbFileToDeepnoteFile(`notebooks/${file}`, {
    outputPath: `projects/${file.replace(/\.ipynb$/, ".deepnote")}`,
    projectName: "Data Pipeline",
    projectId,
  });
}
```

## With error handling

```typescript
import { convertIpynbFileToDeepnoteFile } from "@deepnote/convert";

try {
  await convertIpynbFileToDeepnoteFile("notebook.ipynb", {
    outputPath: "notebook.deepnote",
    projectName: "My Analysis",
  });
  console.log("Conversion successful!");
} catch (error) {
  console.error("Conversion failed:", error.message);
}
```

## API reference

### `convertIpynbFileToDeepnoteFile(inputFilePath, options)`

Converts a Jupyter Notebook file into a single-notebook Deepnote file.

**Parameters:**

- `inputFilePath` (string): Path to the `.ipynb` file to convert
- `options` (ConvertIpynbFileToDeepnoteFileOptions):
  - `outputPath` (string): Path where the `.deepnote` file will be saved
  - `projectName` (string): Name for the Deepnote project
  - `projectId` (string, optional): Project id to assign (defaults to a fresh UUID)

**Returns:** Promise<void>

**Throws:** Error if file reading or parsing fails
