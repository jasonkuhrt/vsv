// Re-exports of VSCode value types (classes, enums) with vsv-curated JSDoc.
//
// These ARE the same identifiers `vscode` exports — vsv adds nothing at
// runtime. The value-add is discoverability (consumers find them via
// `@jasonkuhrt/vsv/runtime` rather than reaching into `'vscode'`) and
// curated documentation that frames each in terms of vsv's typed wrappers.
//
// As gaps close and vsv covers more of VSCode's surface, more value types
// migrate here.

import * as vscode from 'vscode';

/**
 * @description URI representation for files, untitled documents, and remote
 * resources. Carries `scheme`, `authority`, `path`, `query`, `fragment`, and a
 * platform-correct `fsPath` accessor for `file://` URIs.
 *
 * Construct via the static methods:
 *
 * - `Uri.file(fsPath)` — from a local filesystem path
 * - `Uri.parse(str)` — from a stringly-formed URI
 * - `Uri.joinPath(parent, ...segments)` — append path segments to an existing URI
 *
 * URIs are immutable. Mutate via `with({ ... })` to derive a new URI.
 *
 * Re-exported from `vscode.Uri`. Identical at runtime.
 */
export const Uri = vscode.Uri;
export type Uri = vscode.Uri;

/**
 * @description File-type enum used by `vscode.workspace.fs` and `rt.fs.*`
 * operations. Values: `Unknown = 0`, `File = 1`, `Directory = 2`, `SymbolicLink
 * = 64`.
 *
 * `Directory` and `SymbolicLink` can be combined as `Directory | SymbolicLink`
 * to mean "symlink pointing at a directory."
 *
 * Re-exported from `vscode.FileType`. Identical at runtime.
 */
export const FileType = vscode.FileType;
export type FileType = vscode.FileType;

/**
 * @description Configuration target for `WorkspaceConfiguration.update(...)`.
 * Values: `Global = 1`, `Workspace = 2`, `WorkspaceFolder = 3`.
 *
 * Use `Global` for user-scoped settings, `Workspace` for project-shared
 * settings, `WorkspaceFolder` for per-folder settings in multi-root
 * workspaces.
 *
 * Re-exported from `vscode.ConfigurationTarget`. Identical at runtime.
 */
export const ConfigurationTarget = vscode.ConfigurationTarget;
export type ConfigurationTarget = vscode.ConfigurationTarget;

/**
 * @description File stat record returned by `rt.fs.stat(...)`. Carries `type`
 * (a `FileType` bitmask), `ctime`, `mtime`, and `size` (bytes).
 *
 * Type-only re-export from `vscode.FileStat`.
 */
export type FileStat = vscode.FileStat;

/**
 * @description In-memory representation of a text document. Returned by
 * `rt.workspace.openTextDocument(...)`. Carries `uri`, `languageId`, `version`,
 * `lineCount`, and provides `getText(range?)`, `getWordRangeAtPosition(...)`,
 * `lineAt(n)`, and `save()`.
 *
 * Type-only re-export from `vscode.TextDocument`.
 */
export type TextDocument = vscode.TextDocument;

/**
 * @description Event payload emitted when a text document changes. Available
 * via `rt.workspace.onDidChangeTextDocument(...)`.
 *
 * Type-only re-export from `vscode.TextDocumentChangeEvent`.
 */
export type TextDocumentChangeEvent = vscode.TextDocumentChangeEvent;

/**
 * @description Workspace folder. Carries `uri`, `name`, `index`. Available from
 * `rt.workspace.folders()`.
 *
 * Type-only re-export from `vscode.WorkspaceFolder`.
 */
export type WorkspaceFolder = vscode.WorkspaceFolder;

/**
 * @description Extension activation context passed to `activate(ctx)`. Owns
 * subscriptions plus extension/workspace/global storage.
 *
 * Type-only re-export from `vscode.ExtensionContext`.
 */
export type ExtensionContext = vscode.ExtensionContext;

/**
 * @description Disposable resource returned by VS Code registration APIs. Push
 * into `ExtensionContext.subscriptions` or combine with `rt.disposables(...)`.
 *
 * Type-only re-export from `vscode.Disposable`.
 */
export type Disposable = vscode.Disposable;

/**
 * @description Active editor for a text document. Available via
 * `rt.editor.active()`. Carries `document`, `selection` (the primary
 * selection), `selections` (all multi-cursors), `visibleRanges`, and
 * edit/reveal helpers.
 *
 * Type-only re-export from `vscode.TextEditor`.
 */
export type TextEditor = vscode.TextEditor;

/**
 * @description Single editor tab. Available through `rt.tabs.groups()`. `input`
 * carries the per-kind data (text, diff, notebook, terminal, etc.).
 *
 * Type-only re-export from `vscode.Tab`.
 */
export type Tab = vscode.Tab;

/**
 * @description Editor tab group (one per split). Available via
 * `rt.tabs.groups()`. Carries `tabs[]`, `activeTab`, and `viewColumn`.
 *
 * Type-only re-export from `vscode.TabGroup`.
 */
export type TabGroup = vscode.TabGroup;

/**
 * @description Multi-file edit description. Construct via `new
 * WorkspaceEdit()`, add operations with `replace(uri, range, text)`,
 * `insert(uri, position, text)`, `delete(uri, range)`, `createFile(uri)`,
 * `deleteFile(uri)`, `renameFile`.
 *
 * Apply via `rt.workspace.applyEdit(edit)`.
 *
 * Re-exported from `vscode.WorkspaceEdit`. Identical at runtime.
 */
export const WorkspaceEdit = vscode.WorkspaceEdit;
export type WorkspaceEdit = vscode.WorkspaceEdit;

/**
 * @description Closed text range — `[start, end)` of `Position`s. Construct via
 * `new Range(startLine, startChar, endLine, endChar)` or `new Range(startPos,
 * endPos)`.
 *
 * Re-exported from `vscode.Range`. Identical at runtime.
 */
export const Range = vscode.Range;
export type Range = vscode.Range;

/**
 * @description 0-indexed `(line, character)` location in a text document.
 * Construct via `new Position(line, character)`.
 *
 * Re-exported from `vscode.Position`. Identical at runtime.
 */
export const Position = vscode.Position;
export type Position = vscode.Position;
