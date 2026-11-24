import {
  Array,
  Option,
  Record,
  type Schema,
  Cause,
  Effect,
  Exit,
  FileSystem,
  PlatformError,
  Predicate,
} from 'effect';
import type * as vscode from 'vscode';
import {
  ClipboardError,
  CommandExecutionError,
  ConfigUpdateError,
  DocumentSaveError,
  DocumentOpenError,
  FileNotFoundError,
  type FsOperation,
  FsError,
  StateUpdateError,
  UnsupportedSchemeError,
  WorkspaceEditError,
} from './errors.ts';
import type {
  AnyTypedManifest,
  CommandArgs,
  CommandRegistryOf,
  CommandResult,
  ConfigRegistryOf,
  ConfigValue,
  ContextKeyRegistryOf,
  ContextKeyValue,
  EventRegistryOf,
  ExternalCommandArgs,
  ExternalCommandRegistryOf,
  ExternalCommandResult,
  ForeignConfigRegistryOf,
  ForeignConfigValue,
  StateRegistryOf,
  StateScope,
  StateValue,
} from './registries.ts';
import { VSCodeHost } from './vscode-host.ts';
import type { VSCodeHostError } from './vscode-host.ts';

/**
 * @description Handle to a context key. Returned by
 * `runtime.defineContextKey(name, init)`.
 *
 * Context keys are runtime flags VS Code reads in `when` clauses on
 * keybindings, menus, and view visibility. Setting a context key propagates
 * synchronously to VS Code, then to all registered listeners.
 *
 * `set` is Effect-typed with a `never` error channel because VSCode's
 * `setContext` command does not have a documented failure mode. Callers in
 * `Effect.gen` blocks `yield*` it like any other Effect.
 */
export interface ContextKeyHandle<V> {
  /**
   * @description Update the context key. Yields after VSCode's `setContext`
   * propagates.
   */
  set: (value: V) => Effect.Effect<void, VSCodeHostError>;
  /**
   * @description Read the most recent value set through this handle (cached
   * locally).
   */
  readonly get: Effect.Effect<V>;
  /**
   * @description Subscribe to changes set through this handle. Returns a
   * disposable.
   */
  onChange: (cb: (value: V) => void) => Effect.Effect<vscode.Disposable>;
}

/**
 * @description Per-target inspection of a configuration value. Mirrors VSCode's
 * `WorkspaceConfiguration.inspect()` return shape (subset). Use to read a
 * specific scope (e.g. `globalValue`) for the snapshot/mutate/restore pattern:
 * capture the original value, mutate, restore in a `finally` block.
 */
export interface ConfigInspection<V> {
  /**
   * @description Fully-qualified key the inspection refers to.
   */
  key: string;
  /**
   * @description Value declared as the schema/manifest default, if any.
   */
  defaultValue?: V;
  /**
   * @description User-scope value (Settings → User).
   */
  globalValue?: V;
  /**
   * @description Workspace-scope value (Settings → Workspace).
   */
  workspaceValue?: V;
  /**
   * @description Workspace-folder-scope value.
   */
  workspaceFolderValue?: V;
}

/**
 * @description Handle to a configuration setting. Returned by
 * `runtime.defineConfig(key, section?)` for extension-owned settings and
 * `runtime.defineForeignConfig(fullKey)` for foreign (vscode/3rd-party)
 * settings.
 *
 * Reads default to the merged effective value (workspace folder > workspace.
 *
 * > global > default). Updates default to `Workspace` target — pass an explicit
 * > `ConfigurationTarget` to write to user/global.
 *
 * `update` is Effect-typed with `ConfigUpdateError` on the failure channel —
 * raised when VSCode rejects the underlying `WorkspaceConfiguration.update`
 * (e.g. writing to `WorkspaceFolder` outside a multi-root workspace).
 */
export interface ConfigHandle<V> {
  /**
   * @description Read the current value. Returns `undefined` if not set
   * anywhere.
   */
  readonly get: Effect.Effect<V | undefined>;
  /**
   * @description Read the current value, falling back to `defaultValue` if
   * unset.
   */
  getWithDefault: (defaultValue: V) => Effect.Effect<V>;
  /**
   * @description Update the value at the given target. Defaults to `Workspace`.
   * Passing `undefined` clears the value at that target — matches VSCode's
   * actual `WorkspaceConfiguration.update(key, undefined, target)` semantic,
   * which is the correct way to restore a snapshot whose original was unset.
   */
  update: (
    value: V | undefined,
    target?: vscode.ConfigurationTarget,
  ) => Effect.Effect<void, ConfigUpdateError>;
  /**
   * @description Per-target inspection — returns `undefined` if the key has
   * never been set in any scope. The snapshot/mutate/restore pattern uses
   * `inspect()?.globalValue` to capture an original, then `update(...)` to
   * mutate, then `update(original, Global)` in `finally` to restore — passing
   * the original `undefined` clears the slot.
   */
  readonly inspect: Effect.Effect<ConfigInspection<V> | undefined>;
  /**
   * @description Subscribe to changes for this specific key. Returns a
   * disposable.
   */
  onChange: (
    cb: (value: V | undefined) => void,
  ) => Effect.Effect<vscode.Disposable>;
}

/**
 * @description Handle to persistent state. Returned by
 * `runtime.defineState(context, key, scope)`.
 *
 * Backed by VS Code's `globalState` (machine-wide) or `workspaceState`
 * (per-workspace) memento depending on the scope declared in the manifest.
 * Values must be JSON-serializable — VS Code stores them as JSON.
 *
 * `set` and `delete` are Effect-typed with `StateUpdateError` on the failure
 * channel — raised when VSCode's memento rejects (typically a non- serializable
 * value).
 */
export interface StateHandle<V> {
  /**
   * @description Read the current value. Returns `undefined` if never set.
   */
  readonly get: Effect.Effect<V | undefined>;
  /**
   * @description Read the current value, falling back to `defaultValue` if
   * unset.
   */
  getWithDefault: (defaultValue: V) => Effect.Effect<V>;
  /**
   * @description Persist a new value. Yields after the memento write completes.
   */
  set: (value: V) => Effect.Effect<void, StateUpdateError>;
  /**
   * @description Remove the value from the memento.
   */
  readonly delete: Effect.Effect<void, StateUpdateError>;
}

/**
 * @description Handle to a custom event. Returned by
 * `runtime.defineEvent(key)`.
 *
 * Wraps a `vscode.EventEmitter`. Use for cross-module pub/sub within the
 * extension; for VS Code's own events exposed by this runtime, prefer the
 * matching `rt.workspace.*`, `rt.editor.*`, or `rt.tabs.*` Effect surface.
 *
 * All three operations are Effect-wrapped so consumers can keep runtime
 * interaction inside one composition model.
 */
export interface EventHandle<V> {
  /**
   * @description Emit a value to all subscribers.
   */
  fire: (value: V) => Effect.Effect<void>;
  /**
   * @description Subscribe. Returns a disposable that unsubscribes on dispose.
   */
  event: (listener: (value: V) => void) => Effect.Effect<vscode.Disposable>;
  /**
   * @description Dispose the underlying emitter. Subscribers stop receiving
   * events.
   */
  readonly dispose: Effect.Effect<void>;
}

/**
 * @description Item shape for `runtime.quickPick`. The `value` field is what's
 * returned from the picker selection — `label`/`description`/`detail` are for
 * display.
 */
export interface QuickPickItem<T> {
  /**
   * @description Primary text shown in the picker row.
   */
  label: string;
  /**
   * @description Secondary text (right-aligned). Optional.
   */
  description?: string;
  /**
   * @description Tertiary text (smaller, below label). Optional.
   */
  detail?: string;
  /**
   * @description Value returned when this row is picked.
   */
  value: T;
}

/**
 * @description Options for `runtime.notify.prompt`. Maps to a subset of
 * VSCode's `InputBoxOptions` — the subset that's actually useful for
 * keyboard-driven extension prompts. Validation callbacks should become vsv
 * runtime surface when a consumer needs them.
 */
export interface PromptOptions {
  /**
   * @description Prompt text shown above the input field.
   */
  prompt: string;
  /**
   * @description Pre-filled input value.
   */
  value?: string;
  /**
   * @description `[start, end]` selection range within the pre-filled value.
   * Use `[0, value.length]` to select the whole pre-fill so the user can
   * overwrite by typing.
   */
  valueSelection?: [number, number];
  /**
   * @description Greyed-out hint shown when the input is empty.
   */
  placeHolder?: string;
  /**
   * @description Mask the input as a password.
   */
  password?: boolean;
}

/**
 * @description User-facing notification surface. Wraps
 * `vscode.window.show{Information, Warning,Error}Message` and `showInputBox`
 * with a single discoverable namespace.
 *
 * All four methods are non-blocking from the user's perspective — they yield
 * when the notification is dismissed. For `info`/`warn`/`error`, the yielded
 * value is the action button label the user clicked, or `undefined` if
 * dismissed without action.
 *
 * Error channel: `never`. Notifications can't realistically fail at the API
 * boundary; user dismissal is a success-channel `undefined`.
 */
export interface NotifyHandle {
  /**
   * @description Show a non-blocking informational message. Bottom-right toast.
   *
   * Optional `actions` render as buttons on the toast. Yielded value is the
   * label of the clicked button, or `undefined` if the user dismissed without
   * acting. With no actions, always yields `undefined`.
   */
  info: (
    text: string,
    ...actions: ReadonlyArray<string>
  ) => Effect.Effect<string | undefined, VSCodeHostError>;
  /**
   * @description Show a non-blocking warning message. Bottom-right toast with
   * warning icon. Action buttons behave the same as `info`.
   */
  warn: (
    text: string,
    ...actions: ReadonlyArray<string>
  ) => Effect.Effect<string | undefined, VSCodeHostError>;
  /**
   * @description Show a non-blocking error message. Bottom-right toast with
   * error icon. Action buttons behave the same as `info`.
   */
  error: (
    text: string,
    ...actions: ReadonlyArray<string>
  ) => Effect.Effect<string | undefined, VSCodeHostError>;
  /**
   * @description Show an input box at the top of the window. Yields the entered
   * text, or `undefined` if the user dismissed without confirming.
   */
  prompt: (
    options: PromptOptions,
  ) => Effect.Effect<string | undefined, VSCodeHostError>;
}

/**
 * @description System clipboard. Wraps `vscode.env.clipboard`. Both methods are
 * Effect- typed with `ClipboardError` on the failure channel — clipboard IPC
 * can realistically fail on remote development connections.
 *
 * Common pattern: snapshot/restore for clipboard-roundtrip workarounds (e.g.
 * invoking a built-in command that places focused-resource info on the
 * clipboard, then reading it without disturbing the user's copy).
 */
export interface ClipboardHandle {
  /**
   * @description Read the current clipboard text contents. Empty string if
   * clipboard is non-text.
   */
  readonly readText: Effect.Effect<string, ClipboardError>;
  /**
   * @description Replace the clipboard text contents. Does not preserve
   * previous content.
   */
  writeText: (text: string) => Effect.Effect<void, ClipboardError>;
}

/**
 * @description Workspace surface — folders, edits, document IO. Filesystem
 * read/write lives separately on `Runtime.fs`.
 */
export interface WorkspaceHandle {
  /**
   * @description Current workspace folders, or `undefined` when no folder is
   * open (single-file mode). Readonly snapshot — the array is `undefined` vs
   * empty array follows VSCode's own convention: empty workspace ≠ no
   * workspace.
   */
  readonly folders: Effect.Effect<
    readonly vscode.WorkspaceFolder[] | undefined
  >;
  /**
   * @description Subscribe to workspace folder add/remove events. Returns a
   * disposable.
   */
  onDidChangeFolders: (
    cb: (e: vscode.WorkspaceFoldersChangeEvent) => void,
  ) => Effect.Effect<vscode.Disposable>;
  /**
   * @description Subscribe to text-document change events. The callback runs
   * synchronously in VS Code's event dispatch path; start any async work
   * explicitly from the callback.
   */
  onDidChangeTextDocument: (
    cb: (e: vscode.TextDocumentChangeEvent) => void,
  ) => Effect.Effect<vscode.Disposable>;
  /**
   * @description Open a text document by URI or filesystem path. Yields the
   * `TextDocument` (cached if already open). Use this to load file contents for
   * inspection or editing without showing the document in the editor.
   */
  openTextDocument: (
    target: vscode.Uri | string,
  ) => Effect.Effect<vscode.TextDocument, DocumentOpenError>;
  /**
   * @description Save a text document. Yields `true` if the document was saved,
   * `false` if VS Code declined the save without throwing.
   */
  saveTextDocument: (
    document: vscode.TextDocument,
  ) => Effect.Effect<boolean, DocumentSaveError>;
  /**
   * @description Apply a `WorkspaceEdit` to the workspace. Yields `true` if the
   * edit applied cleanly. Construct edits with `new WorkspaceEdit()`
   * (re-exported from `@jasonkuhrt/vsv/runtime`).
   *
   * The success channel still uses `boolean` because VSCode's `applyEdit`
   * distinguishes "edit accepted but rolled back due to conflicts" (returns
   * `false`) from "API call itself errored" (rejects). The former flows through
   * success; the latter through `WorkspaceEditError`.
   */
  applyEdit: (
    edit: vscode.WorkspaceEdit,
  ) => Effect.Effect<boolean, WorkspaceEditError>;
  /**
   * @description Splice the workspace folder list — add, remove, or replace
   * folders. Wraps `vscode.workspace.updateWorkspaceFolders`, which is
   * _synchronous_ and returns `true` if the request was accepted, `false`
   * otherwise (e.g. trying to delete more folders than exist, or invalid
   * args).
   *
   * Effect-wrapped even though VS Code's underlying API is synchronous, so
   * callers can use it uniformly from `Effect.gen`.
   *
   * Single-folder workspaces auto-promote to multi-root the first time this is
   * used to add a folder, which closes and reopens the workspace once. That
   * side-effect is unavoidable.
   */
  updateFolders: (
    start: number,
    deleteCount: number | null | undefined,
    ...workspaceFoldersToAdd: ReadonlyArray<{
      readonly uri: vscode.Uri;
      readonly name?: string;
    }>
  ) => Effect.Effect<boolean>;
}

/**
 * @description Filesystem operations. Wraps `vscode.workspace.fs` — works
 * against any registered file system provider (local, virtual, remote), not
 * just the local OS.
 *
 * Error channel: a union of three tagged errors per operation. High-signal
 * splits get distinct tags so consumers can
 * `Effect.catchTag('FileNotFoundError', ...)` for the common existence-check
 * pattern; the catch-all `FsError` carries everything else with the original
 * error on `cause`.
 */
export interface FsHandle {
  /**
   * @description List the entries of a directory. Yields `[name, type]` tuples
   * directly from VSCode — no filtering or sort applied.
   */
  readDirectory: (
    uri: vscode.Uri,
  ) => Effect.Effect<
    ReadonlyArray<[string, vscode.FileType]>,
    FileNotFoundError | FsError
  >;
  /**
   * @description Stat a file or directory. Fails with `FileNotFoundError` if
   * the path doesn't exist.
   */
  stat: (
    uri: vscode.Uri,
  ) => Effect.Effect<vscode.FileStat, FileNotFoundError | FsError>;
  /**
   * @description Read the entire file contents as a `Uint8Array`. Callers
   * typically wrap the result with `new TextDecoder('utf-8').decode(bytes)` for
   * text formats, or pass the bytes through directly for binary.
   *
   * Fails with `FileNotFoundError` if the file does not exist; `FsError` covers
   * permission denied, IO errors, etc. Wraps `vscode.workspace.fs.readFile` so
   * it works against any registered filesystem provider (local, virtual,
   * remote), not just the local OS.
   */
  readFile: (
    uri: vscode.Uri,
  ) => Effect.Effect<Uint8Array, FileNotFoundError | FsError>;
  /**
   * @description Write the file contents from a `Uint8Array`, replacing any
   * existing contents. The parent directory must exist — call `createDirectory`
   * first if you're not sure (it's idempotent and recursive).
   *
   * Fails with `FileNotFoundError` if the parent directory is missing;
   * `FsError` covers permission denied, IO errors, read-only filesystems, etc.
   * Wraps `vscode.workspace.fs.writeFile`.
   */
  writeFile: (
    uri: vscode.Uri,
    content: Uint8Array,
  ) => Effect.Effect<void, FileNotFoundError | FsError>;
  /**
   * @description Create a directory and any missing parents. Idempotent —
   * succeeds silently if the directory already exists.
   *
   * Fails with `FsError` for permission denied, read-only filesystems, etc.
   * Wraps `vscode.workspace.fs.createDirectory` (which is recursive).
   */
  createDirectory: (
    uri: vscode.Uri,
  ) => Effect.Effect<void, FileNotFoundError | FsError>;
  /**
   * @description Rename or move a file/directory. Pass `overwrite: true` for
   * atomic temp-file replacement patterns.
   */
  rename: (
    source: vscode.Uri,
    target: vscode.Uri,
    options?: { readonly overwrite?: boolean },
  ) => Effect.Effect<void, FileNotFoundError | FsError>;
  /**
   * @description Resolve symlinks in `uri` to the on-disk realpath. Yields a
   * new URI.
   *
   * Local-files only: fails with `UnsupportedSchemeError` if `uri.scheme !==
   * 'file'`. There is no portable realpath across the virtual/remote
   * filesystems served by `vscode.workspace.fs`, so this wrapper internally
   * calls Node `fs.promises.realpath`. For remote/virtual URIs the operation is
   * undefined and the wrapper refuses rather than silently misbehaving.
   *
   * Fails with `FileNotFoundError` if the path does not exist **or the symlink
   * target is missing** (broken symlinks throw `ENOENT` from Node fs, which
   * `toFsError` collapses into `FileNotFoundError`). `FsError` covers
   * non-ENOENT failures: permission denied (`EACCES`), too-many-symlinks
   * (`ELOOP`), busy resource (`EBUSY`), etc.
   */
  realpath: (
    uri: vscode.Uri,
  ) => Effect.Effect<
    vscode.Uri,
    FileNotFoundError | UnsupportedSchemeError | FsError,
    FileSystem.FileSystem
  >;
}

/**
 * @description Window-level UI surfaces that aren't notifications — file/folder
 * pickers, dialogs. Toasts, input boxes, and quick-picks live on `notify` and
 * top-level `quickPick` for now; future versions may consolidate.
 */
export interface WindowHandle {
  /**
   * @description Show the system file/folder picker. Yields the selected URIs
   * as a readonly array, or `undefined` if the user dismissed the dialog.
   *
   * `canSelectMany: false` (the default) still yields an array; pull the first
   * element if you only want one selection.
   *
   * Wraps `vscode.window.showOpenDialog`. Error channel: `never` — dialog
   * dismissal is a success-channel `undefined`.
   */
  showOpenDialog: (
    options?: ShowOpenDialogOptions,
  ) => Effect.Effect<readonly vscode.Uri[] | undefined, VSCodeHostError>;
}

export interface ShowOpenDialogOptions {
  /**
   * @description URI to open the dialog at.
   */
  defaultUri?: vscode.Uri;
  /**
   * @description Confirm button label. Defaults to OS-localized "Open".
   */
  openLabel?: string;
  /**
   * @description Allow selecting files. Default: true.
   */
  canSelectFiles?: boolean;
  /**
   * @description Allow selecting folders. Default: false.
   */
  canSelectFolders?: boolean;
  /**
   * @description Allow selecting more than one entry. Default: false.
   */
  canSelectMany?: boolean;
  /**
   * @description File filters: `{ "Images": ["png", "jpg"], "TypeScript":
   * ["ts"] }`.
   */
  filters?: { readonly [name: string]: ReadonlyArray<string> };
  /**
   * @description Dialog title (some platforms only).
   */
  title?: string;
}

/**
 * @description Active text editor accessor. The editor is `undefined` when
 * focus is on a non-text view (terminal, output, settings, etc.) or no editor
 * exists.
 */
export interface EditorHandle {
  /**
   * @description Currently focused text editor, or `undefined`.
   */
  readonly active: Effect.Effect<vscode.TextEditor | undefined>;
}

/**
 * @description Editor tab management. Wraps `vscode.window.tabGroups`.
 */
export interface TabsHandle {
  /**
   * @description All editor tab groups. Each group holds an array of `tabs` —
   * files, diffs, notebooks, terminals, etc. — plus the `activeTab` and
   * `viewColumn`.
   */
  readonly groups: Effect.Effect<readonly vscode.TabGroup[]>;
  /**
   * @description Close one or more tabs. Accepts a single tab or array. Yields
   * `true` if all targeted tabs were closed.
   */
  close: (
    tabs: vscode.Tab | readonly vscode.Tab[],
  ) => Effect.Effect<boolean, VSCodeHostError>;
}

/**
 * @description Status bar surface. Currently exposes transient messaging at the
 * bottom-left status area; persistent items (priority, alignment, command
 * binding) will land here when a consumer needs them.
 */
export interface StatusBarHandle {
  /**
   * @description Show a transient message in the status bar, auto-clearing
   * after `timeoutMs` (default 1500). Use for command success/failure feedback
   * — anything more than ~3 seconds belongs in a notification, not the status
   * bar.
   *
   * Effect-wrapped for consistency with the rest of the runtime surface.
   */
  message: (text: string, timeoutMs?: number) => Effect.Effect<void>;
}

/**
 * @description Convert an external command's `args` value type (decoded from
 * the manifest's `ExternalCommandDecl`) into the variadic tail of
 * `executeExternalCommand`. The cases:
 *
 * - `void` (nullary command, e.g. `Schema.Void`) → `[]`. Consumer passes only the
 *   id: `rt.executeExternalCommand('moveFileToTrash')`.
 * - Tuple `[A, B, C]` (positional, e.g. `Schema.Tuple(Uri, Position, String)`) →
 *   `[A, B, C]`. Consumer passes positional args:
 *   `rt.executeExternalCommand('vscode.executeDocumentRenameProvider', uri,
 *   pos, name)`.
 * - Anything else → `[T]` (single arg). Mostly an escape hatch for
 *   `Schema.Unknown`.
 *
 * The `[T] extends [void]` form is the canonical pattern for distinguishing
 * exact `void` from other types in conditional types — `T extends void` is too
 * loose because `undefined extends void` is also true.
 */
type VariadicArgs<T> = [T] extends [Schema.Void['Type']]
  ? []
  : T extends readonly unknown[]
    ? T
    : [T];

/**
 * @description Typed runtime surface for a vsv-managed extension. The single
 * generic `M` is the manifest the runtime was created from — its tuple shape
 * (captured via `defineManifest<const M>`) drives the typing of every method
 * via the mapped-type extractors in `./registries.ts`. Id/key mismatches and
 * value-type mistakes surface at compile time without any codegen step.
 *
 * **Effect-native.** Runtime operations that touch VS Code or host state return
 * `Effect.Effect<A, E>`. Consumer extensions write handlers as `Effect.gen`
 * blocks rather than mixing direct VS Code calls, timers, and `async`/`await`.
 * The runtime bridges to VS Code's sync and Promise APIs at the boundary with
 * `Effect.sync`, `Effect.promise`, and `Effect.tryPromise`.
 */
export interface Runtime<M extends AnyTypedManifest = AnyTypedManifest> {
  /**
   * @description Register a command handler. The handler is Effect-typed — it
   * returns `Effect.Effect<R, E>`, where `R` matches the command's declared
   * result type and the error channel is open. The runtime bridges to VSCode's
   * Promise-based `commands.registerCommand` at invocation time, so handler
   * errors land as rejected Promises that VSCode propagates to its
   * command-execution failure path.
   *
   * Yields a `Disposable` — push to `context.subscriptions` so VS Code
   * unregisters the command on extension deactivation.
   */
  defineCommand: <Id extends keyof CommandRegistryOf<M> & string, E>(
    id: Id,
    handler: (
      args: CommandArgs<M, Id>,
    ) => Effect.Effect<CommandResult<M, Id>, E>,
  ) => Effect.Effect<vscode.Disposable>;

  /**
   * @description Invoke a command declared in this extension's manifest. The
   * arg shape and return type are derived from the matching `CommandDecl`. For
   * commands outside the manifest, use `executeCommandRaw`.
   */
  executeCommand: <Id extends keyof CommandRegistryOf<M> & string>(
    id: Id,
    args: CommandArgs<M, Id>,
  ) => Effect.Effect<CommandResult<M, Id>, CommandExecutionError>;

  /**
   * @description Invoke a command declared in the manifest's `externalCommands`
   * (typically a VSCode core command). Args are spread into VSCode's variadic
   * `commands.executeCommand(id, ...args)` call, so the args type in the
   * manifest should typically be a tuple matching the command's positional
   * signature.
   *
   * For commands not declared in the manifest, fall back to
   * `executeCommandRaw`. Prefer this typed form when possible — it surfaces id
   * typos, missing manifest entries, and arg-shape mismatches at compile time.
   *
   * The optional second generic `R` lets the caller pin a more specific result
   * type than the manifest declared, which is the common case when the command
   * returns an opaque VSCode runtime value (e.g. `WorkspaceEdit`, `Location`)
   * that can't be expressed as a Schema. The default is the manifest's declared
   * result.
   *
   * @example
   *   ```ts
   *   // No-arg command, void result:
   *   yield * rt.executeExternalCommand('moveFileToTrash');
   *
   *   // Positional args, opaque result pinned via second generic:
   *   const edit =
   *     yield *
   *     rt.executeExternalCommand<
   *       'vscode.executeDocumentRenameProvider',
   *       WorkspaceEdit | undefined
   *     >('vscode.executeDocumentRenameProvider', uri, position, newName);
   *   ```;
   */
  executeExternalCommand: <
    Id extends keyof ExternalCommandRegistryOf<M> & string,
    R = ExternalCommandResult<M, Id>,
  >(
    id: Id,
    ...args: VariadicArgs<ExternalCommandArgs<M, Id>>
  ) => Effect.Effect<R, CommandExecutionError>;

  /**
   * @description Untyped escape hatch matching
   * `vscode.commands.executeCommand`. Use when the command isn't in the
   * manifest. Prefer typed alternatives when possible.
   */
  executeCommandRaw: (
    id: string,
    ...args: unknown[]
  ) => Effect.Effect<unknown, CommandExecutionError>;

  /**
   * @description Define a context key. Sets the initial value via VSCode's
   * `setContext` and yields a handle for subsequent updates.
   */
  defineContextKey: <K extends keyof ContextKeyRegistryOf<M> & string>(
    key: K,
    initialValue: ContextKeyValue<M, K>,
  ) => Effect.Effect<ContextKeyHandle<ContextKeyValue<M, K>>, VSCodeHostError>;

  /**
   * @description Define a configuration accessor. The optional `section` scopes
   * reads and writes (e.g. `'editor'` for `editor.foo`); omit for root keys.
   */
  defineConfig: <K extends keyof ConfigRegistryOf<M> & string>(
    key: K,
    section?: string,
  ) => Effect.Effect<ConfigHandle<ConfigValue<M, K>>>;

  /**
   * @description Define a typed accessor for a configuration setting **owned by
   * VSCode core or another extension**. Pass the full dotted key (e.g.
   * `editor.codeLens`); the value type is derived from the matching
   * `ForeignConfigDecl` in the manifest.
   *
   * Distinct from `defineConfig` because foreign settings must NOT be
   * re-contributed in `package.json#contributes.configuration` — doing so would
   * corrupt VSCode's settings UI. Foreign settings are declared via
   * `ForeignConfigDecl` and skipped by the package.json sync.
   */
  defineForeignConfig: <K extends keyof ForeignConfigRegistryOf<M> & string>(
    fullKey: K,
  ) => Effect.Effect<ConfigHandle<ForeignConfigValue<M, K>>>;

  /**
   * @description Define a custom event emitter.
   */
  defineEvent: <K extends keyof EventRegistryOf<M>>(
    key: K,
  ) => Effect.Effect<EventHandle<EventRegistryOf<M>[K]>>;

  /**
   * @description Define a typed accessor over `globalState` or
   * `workspaceState`. The `scope` argument must match the scope declared on the
   * matching `StateDecl` in the manifest — TypeScript enforces this through the
   * manifest-derived `StateScope<M, K>` extractor.
   */
  defineState: <K extends keyof StateRegistryOf<M> & string>(
    context: Pick<vscode.ExtensionContext, 'globalState' | 'workspaceState'>,
    key: K,
    scope: StateScope<M, K>,
  ) => Effect.Effect<StateHandle<StateValue<M, K>>>;

  /**
   * @description Show a `QuickPick` over typed items. Yields the picked item's
   * `value` field, or `undefined` if the user dismissed the picker.
   */
  quickPick: <T>(
    items: ReadonlyArray<QuickPickItem<T>>,
    options?: { placeHolder?: string; canPickMany?: false },
  ) => Effect.Effect<T | undefined, VSCodeHostError>;

  /**
   * @description User-facing notifications — info/warn/error toasts and modal
   * input prompt. Closes the gap left by raw `vscode.window.show*Message` /
   * `showInputBox` calls scattered through extension code.
   */
  notify: NotifyHandle;

  /**
   * @description Status bar messaging. Replaces raw
   * `vscode.window.setStatusBarMessage` calls with a discoverable namespace.
   */
  statusBar: StatusBarHandle;

  /**
   * @description System clipboard read/write. Replaces raw
   * `vscode.env.clipboard.*` calls.
   */
  clipboard: ClipboardHandle;

  /**
   * @description Workspace surface. Folder list + change events + document IO.
   * Filesystem read/write lives on `Runtime.fs`.
   */
  workspace: WorkspaceHandle;

  /**
   * @description Filesystem operations. Replaces raw `vscode.workspace.fs.*`
   * calls.
   */
  fs: FsHandle;

  /**
   * @description Active text editor accessor. Replaces raw
   * `vscode.window.activeTextEditor` reads.
   */
  editor: EditorHandle;

  /**
   * @description Editor tab management. Replaces raw
   * `vscode.window.tabGroups.*` calls.
   */
  tabs: TabsHandle;

  /**
   * @description Window-level UI surfaces — file/folder pickers and other
   * dialogs that aren't notifications. Replaces raw
   * `vscode.window.showOpenDialog` calls.
   */
  window: WindowHandle;

  /**
   * @description Combine multiple disposables into one. Equivalent to
   * `vscode.Disposable.from(...)` but accepts the more permissive `{ dispose }`
   * shape.
   */
  disposables: (
    ...ds: Array<{ dispose: () => void }>
  ) => Effect.Effect<vscode.Disposable>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — error mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Map a VSCode `FileSystemError` (or Node `ErrnoException`) thrown
 * by an fs operation into the typed error channel. `FileNotFound` / `ENOENT`
 * get a distinct `FileNotFoundError`; everything else collapses into `FsError`
 * with the original on `cause`.
 *
 * The `code` check covers both VSCode's string codes (`'FileNotFound'`,
 * `'NoPermissions'`, etc.) and Node's errno codes (`'ENOENT'`, `'EACCES'`,
 * etc.) since `realpath` drops to Node's fs module.
 */
const toFsError =
  (uri: vscode.Uri, operation: FsOperation) =>
  (cause: unknown): FileNotFoundError | FsError => {
    const code = Predicate.hasProperty(cause, 'code') ? cause.code : undefined;
    const notFound =
      PlatformError.isPlatformError(cause) && cause.reason._tag === 'NotFound';
    if (notFound || code === 'FileNotFound' || code === 'ENOENT') {
      return FileNotFoundError.make({ uri, operation, cause });
    }
    return FsError.make({ uri, operation, cause });
  };

// ─────────────────────────────────────────────────────────────────────────────
// createRuntime — Effect-native runtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @description Create a typed runtime instance keyed off the consumer's
 * manifest. The manifest's tuple shape (captured via `defineManifest<const M>`)
 * drives the typing of every method — no codegen detour, no generic-list to
 * thread.
 *
 * @example
 *   ```ts
 *   import manifest from '../vsv.manifest.ts';
 *   import { createRuntime } from '@jasonkuhrt/vsv/runtime';
 *   import { VSCodeLive } from '@jasonkuhrt/vsv/runtime/vscode';
 *   import { Effect } from 'effect';
 *
 *   const runtime = createRuntime(manifest).pipe(Effect.provide(VSCodeLive));
 *   ```;
 */
export const createRuntime = <M extends AnyTypedManifest = AnyTypedManifest>(
  _manifest: M,
): Effect.Effect<Runtime<M>, never, VSCodeHost> =>
  Effect.map(VSCodeHost, (host): Runtime<M> => ({
    defineCommand: <Id extends keyof CommandRegistryOf<M> & string, E>(
      id: Id,
      handler: (
        args: CommandArgs<M, Id>,
      ) => Effect.Effect<CommandResult<M, Id>, E>,
    ): Effect.Effect<vscode.Disposable> =>
      Effect.sync(() =>
        host.commands.registerCommand(id, (args: CommandArgs<M, Id>) =>
          Effect.runPromise(handler(args)),
        ),
      ),

    executeCommand: <Id extends keyof CommandRegistryOf<M> & string>(
      id: Id,
      args: CommandArgs<M, Id>,
    ): Effect.Effect<CommandResult<M, Id>, CommandExecutionError> =>
      host.commands
        .executeCommand<CommandResult<M, Id>>(id, args)
        .pipe(
          Effect.mapError(({ cause }) =>
            CommandExecutionError.make({ id, cause }),
          ),
        ),

    executeExternalCommand: <
      Id extends keyof ExternalCommandRegistryOf<M> & string,
      R = ExternalCommandResult<M, Id>,
    >(
      id: Id,
      ...args: VariadicArgs<ExternalCommandArgs<M, Id>>
    ): Effect.Effect<R, CommandExecutionError> =>
      host.commands
        .executeCommand<R>(id, ...args)
        .pipe(
          Effect.mapError(({ cause }) =>
            CommandExecutionError.make({ id, cause }),
          ),
        ),

    executeCommandRaw: (
      id: string,
      ...args: unknown[]
    ): Effect.Effect<unknown, CommandExecutionError> =>
      host.commands
        .executeCommand(id, ...args)
        .pipe(
          Effect.mapError(({ cause }) =>
            CommandExecutionError.make({ id, cause }),
          ),
        ),

    defineContextKey: Effect.fnUntraced(function* <
      K extends keyof ContextKeyRegistryOf<M> & string,
    >(key: K, initialValue: ContextKeyValue<M, K>) {
      let current = initialValue;
      const listeners = new Set<(value: ContextKeyValue<M, K>) => void>();
      yield* host.commands.executeCommand('setContext', key, current);
      return {
        set: Effect.fnUntraced(function* (value: ContextKeyValue<M, K>) {
          yield* host.commands.executeCommand('setContext', key, value);
          current = value;
          for (const listener of listeners) {
            const result = yield* Effect.exit(
              Effect.sync(() => {
                listener(value);
              }),
            );
            if (Exit.isFailure(result)) {
              yield* Effect.logError(
                `vsv: context-key '${key}' listener threw`,
                Cause.pretty(result.cause),
              );
            }
          }
        }),
        get: Effect.sync(() => current),
        onChange: (
          cb: (v: ContextKeyValue<M, K>) => void,
        ): Effect.Effect<vscode.Disposable> =>
          Effect.sync(() => {
            listeners.add(cb);
            return {
              dispose: () => {
                listeners.delete(cb);
              },
            };
          }),
      };
    }),

    defineConfig: <K extends keyof ConfigRegistryOf<M> & string>(
      key: K,
      section?: string,
    ) =>
      Effect.sync(() => {
        const getCfg = () => host.workspace.getConfiguration(section);
        const fullKey = section === undefined ? key : `${section}.${key}`;
        type V = ConfigValue<M, K>;
        return {
          get: Effect.sync(() => getCfg().get<V>(key)),
          getWithDefault: (defaultValue: V): Effect.Effect<V> =>
            Effect.sync(() => getCfg().get<V>(key, defaultValue)),
          update: (
            value: V | undefined,
            target: vscode.ConfigurationTarget = host.ConfigurationTarget
              .Workspace,
          ): Effect.Effect<void, ConfigUpdateError> =>
            Effect.suspend(() => getCfg().update(key, value, target)).pipe(
              Effect.mapError(({ cause }) =>
                ConfigUpdateError.make({ key: fullKey, target, cause }),
              ),
            ),
          inspect: Effect.sync(() => {
            const ins = getCfg().inspect<V>(key);
            if (ins === undefined) return undefined;
            const out: ConfigInspection<V> = { key: ins.key };
            if (ins.defaultValue !== undefined)
              out.defaultValue = ins.defaultValue;
            if (ins.globalValue !== undefined)
              out.globalValue = ins.globalValue;
            if (ins.workspaceValue !== undefined)
              out.workspaceValue = ins.workspaceValue;
            if (ins.workspaceFolderValue !== undefined)
              out.workspaceFolderValue = ins.workspaceFolderValue;
            return out;
          }),
          onChange: (
            cb: (value: V | undefined) => void,
          ): Effect.Effect<vscode.Disposable> =>
            Effect.sync(() =>
              host.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(fullKey)) {
                  cb(getCfg().get<V>(key));
                }
              }),
            ),
        };
      }),

    // Foreign configs are accessed at the root config level using the full
    // dotted key. This avoids ambiguity for nested settings like
    // `typescript.preferences.useAliasesForRenames` where the section/key split
    // is not unique.
    defineForeignConfig: <K extends keyof ForeignConfigRegistryOf<M> & string>(
      fullKey: K,
    ) =>
      Effect.sync(() => {
        const getCfg = () => host.workspace.getConfiguration();
        type V = ForeignConfigValue<M, K>;
        return {
          get: Effect.sync(() => getCfg().get<V>(fullKey)),
          getWithDefault: (defaultValue: V): Effect.Effect<V> =>
            Effect.sync(() => getCfg().get<V>(fullKey, defaultValue)),
          update: (
            value: V | undefined,
            target: vscode.ConfigurationTarget = host.ConfigurationTarget
              .Workspace,
          ): Effect.Effect<void, ConfigUpdateError> =>
            Effect.suspend(() => getCfg().update(fullKey, value, target)).pipe(
              Effect.mapError(({ cause }) =>
                ConfigUpdateError.make({ key: fullKey, target, cause }),
              ),
            ),
          inspect: Effect.sync(() => {
            const ins = getCfg().inspect<V>(fullKey);
            if (ins === undefined) return undefined;
            const out: ConfigInspection<V> = { key: ins.key };
            if (ins.defaultValue !== undefined)
              out.defaultValue = ins.defaultValue;
            if (ins.globalValue !== undefined)
              out.globalValue = ins.globalValue;
            if (ins.workspaceValue !== undefined)
              out.workspaceValue = ins.workspaceValue;
            if (ins.workspaceFolderValue !== undefined)
              out.workspaceFolderValue = ins.workspaceFolderValue;
            return out;
          }),
          onChange: (
            cb: (value: V | undefined) => void,
          ): Effect.Effect<vscode.Disposable> =>
            Effect.sync(() =>
              host.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(fullKey)) {
                  cb(getCfg().get<V>(fullKey));
                }
              }),
            ),
        };
      }),

    defineEvent: <K extends keyof EventRegistryOf<M>>(
      _key: K,
    ): Effect.Effect<EventHandle<EventRegistryOf<M>[K]>> =>
      Effect.sync(() => {
        type V = EventRegistryOf<M>[K];
        const emitter = new host.EventEmitter<V>();
        return {
          fire: (value: V): Effect.Effect<void> =>
            Effect.sync(() => {
              emitter.fire(value);
            }),
          event: (
            listener: (value: V) => void,
          ): Effect.Effect<vscode.Disposable> =>
            Effect.sync(() => emitter.event(listener)),
          dispose: Effect.sync(() => {
            emitter.dispose();
          }),
        };
      }),

    defineState: <K extends keyof StateRegistryOf<M> & string>(
      context: Pick<vscode.ExtensionContext, 'globalState' | 'workspaceState'>,
      key: K,
      scope: StateScope<M, K>,
    ) =>
      Effect.sync(() => {
        const memento =
          scope === 'global' ? context.globalState : context.workspaceState;
        type V = StateValue<M, K>;
        return {
          get: Effect.sync(() => memento.get<V>(key)),
          getWithDefault: (defaultValue: V): Effect.Effect<V> =>
            Effect.sync(() => memento.get<V>(key, defaultValue)),
          set: (value: V): Effect.Effect<void, StateUpdateError> =>
            Effect.tryPromise({
              try: () => memento.update(key, value),
              catch: (cause) =>
                StateUpdateError.make({ key, operation: 'set', cause }),
            }),
          delete: Effect.tryPromise({
            try: () => memento.update(key, undefined),
            catch: (cause) =>
              StateUpdateError.make({ key, operation: 'delete', cause }),
          }),
        };
      }),

    quickPick: <T>(
      items: ReadonlyArray<QuickPickItem<T>>,
      options?: { placeHolder?: string; canPickMany?: false },
    ): Effect.Effect<T | undefined, VSCodeHostError> =>
      Effect.gen(function* () {
        const pickable: vscode.QuickPickItem[] = Array.map(items, (item) => {
          const entry: vscode.QuickPickItem = { label: item.label };
          if (item.description !== undefined)
            entry.description = item.description;
          if (item.detail !== undefined) entry.detail = item.detail;
          return entry;
        });
        const pickOptions: vscode.QuickPickOptions = { canPickMany: false };
        if (options?.placeHolder !== undefined)
          pickOptions.placeHolder = options.placeHolder;
        const picked = yield* host.window.showQuickPick(pickable, pickOptions);
        if (picked === undefined) return undefined;
        const match = Option.getOrUndefined(
          Array.findFirst(items, (i) => i.label === picked.label),
        );
        return match?.value;
      }),

    notify: {
      info: (
        text: string,
        ...actions: ReadonlyArray<string>
      ): Effect.Effect<string | undefined, VSCodeHostError> =>
        host.window.showInformationMessage(text, ...actions),
      warn: (
        text: string,
        ...actions: ReadonlyArray<string>
      ): Effect.Effect<string | undefined, VSCodeHostError> =>
        host.window.showWarningMessage(text, ...actions),
      error: (
        text: string,
        ...actions: ReadonlyArray<string>
      ): Effect.Effect<string | undefined, VSCodeHostError> =>
        host.window.showErrorMessage(text, ...actions),
      prompt: (
        options: PromptOptions,
      ): Effect.Effect<string | undefined, VSCodeHostError> =>
        Effect.suspend(() => {
          // Build the vscode-shaped options object incrementally — passing
          // `undefined` values explicitly trips strict optional-property checks
          // on `vscode.InputBoxOptions`.
          const vscodeOpts: vscode.InputBoxOptions = { prompt: options.prompt };
          if (options.value !== undefined) vscodeOpts.value = options.value;
          if (options.valueSelection !== undefined)
            vscodeOpts.valueSelection = options.valueSelection;
          if (options.placeHolder !== undefined)
            vscodeOpts.placeHolder = options.placeHolder;
          if (options.password !== undefined)
            vscodeOpts.password = options.password;
          return host.window.showInputBox(vscodeOpts);
        }),
    },

    statusBar: {
      message: (text: string, timeoutMs = 1500): Effect.Effect<void> =>
        Effect.sync(() => {
          host.window.setStatusBarMessage(text, timeoutMs);
        }),
    },

    clipboard: {
      readText: host.env.clipboard
        .readText()
        .pipe(
          Effect.mapError(({ cause }) =>
            ClipboardError.make({ operation: 'readText', cause }),
          ),
        ),
      writeText: (text: string): Effect.Effect<void, ClipboardError> =>
        host.env.clipboard
          .writeText(text)
          .pipe(
            Effect.mapError(({ cause }) =>
              ClipboardError.make({ operation: 'writeText', cause }),
            ),
          ),
    },

    workspace: {
      folders: Effect.sync(() => host.workspace.workspaceFolders),
      onDidChangeFolders: (
        cb: (e: vscode.WorkspaceFoldersChangeEvent) => void,
      ): Effect.Effect<vscode.Disposable> =>
        Effect.sync(() => host.workspace.onDidChangeWorkspaceFolders(cb)),
      onDidChangeTextDocument: (
        cb: (e: vscode.TextDocumentChangeEvent) => void,
      ): Effect.Effect<vscode.Disposable> =>
        Effect.sync(() => host.workspace.onDidChangeTextDocument(cb)),
      openTextDocument: (
        target: vscode.Uri | string,
      ): Effect.Effect<vscode.TextDocument, DocumentOpenError> =>
        host.workspace
          .openTextDocument(target)
          .pipe(
            Effect.mapError(({ cause }) =>
              DocumentOpenError.make({ target, cause }),
            ),
          ),
      saveTextDocument: (
        document: vscode.TextDocument,
      ): Effect.Effect<boolean, DocumentSaveError> =>
        Effect.tryPromise({
          try: () => document.save(),
          catch: (cause) =>
            DocumentSaveError.make({ uri: document.uri, cause }),
        }),
      applyEdit: (
        edit: vscode.WorkspaceEdit,
      ): Effect.Effect<boolean, WorkspaceEditError> =>
        host.workspace
          .applyEdit(edit)
          .pipe(
            Effect.mapError(({ cause }) => WorkspaceEditError.make({ cause })),
          ),
      updateFolders: (
        start: number,
        deleteCount: number | null | undefined,
        ...adds: ReadonlyArray<{
          readonly uri: vscode.Uri;
          readonly name?: string;
        }>
      ): Effect.Effect<boolean> =>
        Effect.sync(() =>
          host.workspace.updateWorkspaceFolders(start, deleteCount, ...adds),
        ),
    },

    fs: {
      readDirectory: (
        uri: vscode.Uri,
      ): Effect.Effect<
        ReadonlyArray<[string, vscode.FileType]>,
        FileNotFoundError | FsError
      > =>
        host.workspace.fs
          .readDirectory(uri)
          .pipe(
            Effect.mapError(({ cause }) =>
              toFsError(uri, 'readDirectory')(cause),
            ),
          ),
      stat: (
        uri: vscode.Uri,
      ): Effect.Effect<vscode.FileStat, FileNotFoundError | FsError> =>
        host.workspace.fs
          .stat(uri)
          .pipe(Effect.mapError(({ cause }) => toFsError(uri, 'stat')(cause))),
      readFile: (
        uri: vscode.Uri,
      ): Effect.Effect<Uint8Array, FileNotFoundError | FsError> =>
        host.workspace.fs
          .readFile(uri)
          .pipe(
            Effect.mapError(({ cause }) => toFsError(uri, 'readFile')(cause)),
          ),
      writeFile: (
        uri: vscode.Uri,
        content: Uint8Array,
      ): Effect.Effect<void, FileNotFoundError | FsError> =>
        host.workspace.fs
          .writeFile(uri, content)
          .pipe(
            Effect.mapError(({ cause }) => toFsError(uri, 'writeFile')(cause)),
          ),
      createDirectory: (
        uri: vscode.Uri,
      ): Effect.Effect<void, FileNotFoundError | FsError> =>
        host.workspace.fs
          .createDirectory(uri)
          .pipe(
            Effect.mapError(({ cause }) =>
              toFsError(uri, 'createDirectory')(cause),
            ),
          ),
      rename: (
        source: vscode.Uri,
        target: vscode.Uri,
        options?: { readonly overwrite?: boolean },
      ): Effect.Effect<void, FileNotFoundError | FsError> =>
        host.workspace.fs
          .rename(source, target, options)
          .pipe(
            Effect.mapError(({ cause }) => toFsError(source, 'rename')(cause)),
          ),
      realpath: Effect.fnUntraced(function* (uri: vscode.Uri) {
        if (uri.scheme !== 'file') {
          return yield* UnsupportedSchemeError.make({
            uri,
            operation: 'realpath',
            expectedScheme: 'file',
          });
        }
        const fs = yield* FileSystem.FileSystem;
        return yield* fs.realPath(uri.fsPath).pipe(
          Effect.mapBoth({
            onSuccess: host.Uri.file,
            onFailure: toFsError(uri, 'realpath'),
          }),
        );
      }),
    },

    editor: {
      active: Effect.sync(() => host.window.activeTextEditor),
    },

    tabs: {
      groups: Effect.sync(() => host.window.tabGroups.all),
      close: (
        tabs: vscode.Tab | readonly vscode.Tab[],
      ): Effect.Effect<boolean, VSCodeHostError> =>
        'label' in tabs
          ? host.window.tabGroups.close(tabs)
          : host.window.tabGroups.close([...tabs]),
    },

    window: {
      showOpenDialog: (
        options?: ShowOpenDialogOptions,
      ): Effect.Effect<readonly vscode.Uri[] | undefined, VSCodeHostError> =>
        Effect.suspend(() => {
          // Build the vscode-shaped options object incrementally — passing
          // `undefined` values explicitly trips strict optional-property checks
          // on `vscode.OpenDialogOptions`. Same pattern as `notify.prompt`.
          const vscodeOpts: vscode.OpenDialogOptions = {};
          if (options?.defaultUri !== undefined)
            vscodeOpts.defaultUri = options.defaultUri;
          if (options?.openLabel !== undefined)
            vscodeOpts.openLabel = options.openLabel;
          if (options?.canSelectFiles !== undefined)
            vscodeOpts.canSelectFiles = options.canSelectFiles;
          if (options?.canSelectFolders !== undefined) {
            vscodeOpts.canSelectFolders = options.canSelectFolders;
          }
          if (options?.canSelectMany !== undefined)
            vscodeOpts.canSelectMany = options.canSelectMany;
          if (options?.filters !== undefined) {
            // Filter values are mutable arrays in VSCode's type; copy through.
            vscodeOpts.filters = Record.fromEntries(
              Array.map(Record.toEntries(options.filters), ([k, v]) => [
                k,
                [...v],
              ]),
            );
          }
          if (options?.title !== undefined) vscodeOpts.title = options.title;
          return host.window.showOpenDialog(vscodeOpts);
        }),
    },

    disposables: (
      ...ds: Array<{ dispose: () => void }>
    ): Effect.Effect<vscode.Disposable> =>
      Effect.sync(() => host.Disposable.from(...ds)),
  }));
