export { createRuntime } from '#lib/runtime/create';
export { Layout } from '#lib/runtime/layout';
export type { LayoutFocusTarget } from '#lib/runtime/layout';
export {
  ClipboardError,
  CommandExecutionError,
  ConfigUpdateError,
  DocumentOpenError,
  DocumentSaveError,
  FileNotFoundError,
  FsError,
  StateUpdateError,
  UnsupportedSchemeError,
  WorkspaceEditError,
} from '#lib/runtime/errors';
export type { RuntimeError } from '#lib/runtime/errors';
export type {
  ConfigurationTarget,
  FileType,
  Position,
  Range,
  Uri,
  WorkspaceEdit,
} from '#lib/runtime/values';
export type {
  Disposable,
  ExtensionContext,
  FileStat,
  Tab,
  TabGroup,
  TextDocument,
  TextDocumentChangeEvent,
  TextEditor,
  WorkspaceFolder,
} from '#lib/runtime/values';
export type {
  ClipboardHandle,
  ConfigHandle,
  ConfigInspection,
  ContextKeyHandle,
  EditorHandle,
  EventHandle,
  FsHandle,
  NotifyHandle,
  PromptOptions,
  QuickPickItem,
  Runtime,
  ShowOpenDialogOptions,
  StatusBarHandle,
  StateHandle,
  TabsHandle,
  WindowHandle,
  WorkspaceHandle,
} from '#lib/runtime/create';

export { VSCodeHost, VSCodeHostError } from '#lib/runtime/vscode-host';
