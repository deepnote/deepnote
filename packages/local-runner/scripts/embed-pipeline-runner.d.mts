/** Types for the embed script, which the conformance test imports to check for drift. */
export declare const SOURCE: string
export declare const NOTEBOOK: string
export declare function embeddableSource(python: string): string
export declare function renderCell(python: string): string
export declare function replaceEmbedded(notebook: string, python: string): string
