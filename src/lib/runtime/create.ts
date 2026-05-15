import { Cause, Effect, Exit } from 'effect'
import * as fs from 'node:fs'
import * as vscode from 'vscode'
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
} from './registries.ts'
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
} from './errors.ts'

/**
 * Handle to a context key. Returned by `runtime.defineContextKey(name, init)`.
 *
 * Context keys are runtime flags VS Code reads in `when` clauses on
 * keybindings, menus, and view visibility. Setting a context key
 * propagates synchronously to VS Code, then to all registered listeners.
 *
 * `set` is Effect-typed with a `never` error channel because VSCode's
 * `setContext` command does not have a documented failure mode. Callers in
 * `Effect.gen` blocks `yield*` it like any other Effect.
 */
export interface ContextKeyHandle<V> {
  /** Update the context key. Yields after VSCode's `setContext` propagates. */
  set: (value: V) => Effect.Effect<void>
  /** Read the most recent value set through this handle (cached locally). */
  get: () => Effect.Effect<V>
  /** Subscribe to changes set through this handle. Returns a disposable. */
  onChange: (cb: (value: V) => void) => Effect.Effect<vscode.Disposable>
}

/**
 * Per-target inspection of a configuration value. Mirrors VSCode's
 * `WorkspaceConfiguration.inspect()` return shape (subset). Use to read
 * a specific scope (e.g. `globalValue`) for the snapshot/mutate/restore
 * pattern: capture the original value, mutate, restore in a `finally` block.
 */
export interface ConfigInspection<V> {
  /** Fully-qualified key the inspection refers to. */
  key: string
  /** Value declared as the schema/manifest default, if any. */
  defaultValue?: V
  /** User-scope value (Settings → User). */
  globalValue?: V
  /** Workspace-scope value (Settings → Workspace). */
  workspaceValue?: V
  /** Workspace-folder-scope value. */
  workspaceFolderValue?: V
}

/**
 * Handle to a configuration setting. Returned by
 * `runtime.defineConfig(key, section?)` for extension-owned settings and
 * `runtime.defineForeignConfig(fullKey)` for foreign (vscode/3rd-party) settings.
 *
 * Reads default to the merged effective value (workspace folder > workspace
 * > global > default). Updates default to `Workspace` target — pass an
 * explicit `ConfigurationTarget` to write to user/global.
 *
 * `update` is Effect-typed with `ConfigUpdateError` on the failure channel —
 * raised when VSCode rejects the underlying `WorkspaceConfiguration.update`
 * (e.g. writing to `WorkspaceFolder` outside a multi-root workspace).
 */
export interface ConfigHandle<V> {
  /** Read the current value. Returns `undefined` if not set anywhere. */
  get: () => Effect.Effect<V | undefined>
  /** Read the current value, falling back to `defaultValue` if unset. */
  getWithDefault: (defaultValue: V) => Effect.Effect<V>
  /**
   * Update the value at the given target. Defaults to `Workspace`. Passing
   * `undefined` clears the value at that target — matches VSCode's actual
   * `WorkspaceConfiguration.update(key, undefined, target)` semantic, which
   * is the correct way to restore a snapshot whose original was unset.
   */
  update: (
    value: V | undefined,
    target?: vscode.ConfigurationTarget,
  ) => Effect.Effect<void, ConfigUpdateError>
  /**
   * Per-target inspection — returns `undefined` if the key has never been
   * set in any scope. The snapshot/mutate/restore pattern uses
   * `inspect()?.globalValue` to capture an original, then `update(...)` to
   * mutate, then `update(original, Global)` in `finally` to restore — passing
   * the original `undefined` clears the slot.
   */
  inspect: () => Effect.Effect<ConfigInspection<V> | undefined>
  /** Subscribe to changes for this specific key. Returns a disposable. */
  onChange: (cb: (value: V | undefined) => void) => Effect.Effect<vscode.Disposable>
}

/**
 * Handle to persistent state. Returned by
 * `runtime.defineState(context, key, scope)`.
 *
 * Backed by VS Code's `globalState` (machine-wide) or `workspaceState`
 * (per-workspace) memento depending on the scope declared in the manifest.
 * Values must be JSON-serializable — VS Code stores them as JSON.
 *
 * `set` and `delete` are Effect-typed with `StateUpdateError` on the failure
 * channel — raised when VSCode's memento rejects (typically a non-
 * serializable value).
 */
export interface StateHandle<V> {
  /** Read the current value. Returns `undefined` if never set. */
  get: () => Effect.Effect<V | undefined>
  /** Read the current value, falling back to `defaultValue` if unset. */
  getWithDefault: (defaultValue: V) => Effect.Effect<V>
  /** Persist a new value. Yields after the memento write completes. */
  set: (value: V) => Effect.Effect<void, StateUpdateError>
  /** Remove the value from the memento. */
  delete: () => Effect.Effect<void, StateUpdateError>
}

/**
 * Handle to a custom event. Returned by `runtime.defineEvent(key)`.
 *
 * Wraps a `vscode.EventEmitter`. Use for cross-module pub/sub within the
 * extension; for VS Code's own events exposed by this runtime, prefer the
 * matching `rt.workspace.*`, `rt.editor.*`, or `rt.tabs.*` Effect surface.
 *
 * All three operations are Effect-wrapped so consumers can keep runtime
 * interaction inside one composition model.
 */
export interface EventHandle<V> {
  /** Emit a value to all subscribers. */
  fire: (value: V) => Effect.Effect<void>
  /** Subscribe. Returns a disposable that unsubscribes on dispose. */
  event: (listener: (value: V) => void) => Effect.Effect<vscode.Disposable>
  /** Dispose the underlying emitter. Subscribers stop receiving events. */
  dispose: () => Effect.Effect<void>
}

/**
 * Item shape for `runtime.quickPick`. The `value` field is what's returned
 * from the picker selection — `label`/`description`/`detail` are for display.
 */
export interface QuickPickItem<T> {
  /** Primary text shown in the picker row. */
  label: string
  /** Secondary text (right-aligned). Optional. */
  description?: string
  /** Tertiary text (smaller, below label). Optional. */
  detail?: string
  /** Value returned when this row is picked. */
  value: T
}

/**
 * Options for `runtime.notify.prompt`. Maps to a subset of VSCode's
 * `InputBoxOptions` — the subset that's actually useful for keyboard-driven
 * extension prompts. Validation callbacks should become vsv runtime surface
 * when a consumer needs them.
 */
export interface PromptOptions {
  /** Prompt text shown above the input field. */
  prompt: string
  /** Pre-filled input value. */
  value?: string
  /**
   * `[start, end]` selection range within the pre-filled value. Use `[0, value.length]`
   * to select the whole pre-fill so the user can overwrite by typing.
   */
  valueSelection?: [number, number]
  /** Greyed-out hint shown when the input is empty. */
  placeHolder?: string
  /** Mask the input as a password. */
  password?: boolean
}

/**
 * User-facing notification surface. Wraps `vscode.window.show{Information,
 * Warning,Error}Message` and `showInputBox` with a single discoverable
 * namespace.
 *
 * All four methods are non-blocking from the user's perspective — they
 * yield when the notification is dismissed. For `info`/`warn`/`error`, the
 * yielded value is the action button label the user clicked, or `undefined`
 * if dismissed without action.
 *
 * Error channel: `never`. Notifications can't realistically fail at the API
 * boundary; user dismissal is a success-channel `undefined`.
 */
export interface NotifyHandle {
  /**
   * Show a non-blocking informational message. Bottom-right toast.
   *
   * Optional `actions` render as buttons on the toast. Yielded value is the
   * label of the clicked button, or `undefined` if the user dismissed
   * without acting. With no actions, always yields `undefined`.
   */
  info: (text: string, ...actions: ReadonlyArray<string>) => Effect.Effect<string | undefined>
  /**
   * Show a non-blocking warning message. Bottom-right toast with warning icon.
   * Action buttons behave the same as `info`.
   */
  warn: (text: string, ...actions: ReadonlyArray<string>) => Effect.Effect<string | undefined>
  /**
   * Show a non-blocking error message. Bottom-right toast with error icon.
   * Action buttons behave the same as `info`.
   */
  error: (text: string, ...actions: ReadonlyArray<string>) => Effect.Effect<string | undefined>
  /**
   * Show an input box at the top of the window. Yields the entered text,
   * or `undefined` if the user dismissed without confirming.
   */
  prompt: (options: PromptOptions) => Effect.Effect<string | undefined>
}

/**
 * System clipboard. Wraps `vscode.env.clipboard`. Both methods are Effect-
 * typed with `ClipboardError` on the failure channel — clipboard IPC can
 * realistically fail on remote development connections.
 *
 * Common pattern: snapshot/restore for clipboard-roundtrip workarounds
 * (e.g. invoking a built-in command that places focused-resource info on
 * the clipboard, then reading it without disturbing the user's copy).
 */
export interface ClipboardHandle {
  /** Read the current clipboard text contents. Empty string if clipboard is non-text. */
  readText: () => Effect.Effect<string, ClipboardError>
  /** Replace the clipboard text contents. Does not preserve previous content. */
  writeText: (text: string) => Effect.Effect<void, ClipboardError>
}

/**
 * Workspace surface — folders, edits, document IO. Filesystem read/write
 * lives separately on `Runtime.fs`.
 */
export interface WorkspaceHandle {
  /**
   * Current workspace folders, or `undefined` when no folder is open
   * (single-file mode). Readonly snapshot — the array is `undefined` vs
   * empty array follows VSCode's own convention: empty workspace ≠ no
   * workspace.
   */
  folders: () => Effect.Effect<readonly vscode.WorkspaceFolder[] | undefined>
  /**
   * Subscribe to workspace folder add/remove events. Returns a disposable.
   */
  onDidChangeFolders: (
    cb: (e: vscode.WorkspaceFoldersChangeEvent) => void,
  ) => Effect.Effect<vscode.Disposable>
  /**
   * Subscribe to text-document change events. The callback runs synchronously
   * in VS Code's event dispatch path; start any async work explicitly from
   * the callback.
   */
  onDidChangeTextDocument: (
    cb: (e: vscode.TextDocumentChangeEvent) => void,
  ) => Effect.Effect<vscode.Disposable>
  /**
   * Open a text document by URI or filesystem path. Yields the
   * `TextDocument` (cached if already open). Use this to load file
   * contents for inspection or editing without showing the document in
   * the editor.
   */
  openTextDocument: (
    target: vscode.Uri | string,
  ) => Effect.Effect<vscode.TextDocument, DocumentOpenError>
  /**
   * Save a text document. Yields `true` if the document was saved, `false`
   * if VS Code declined the save without throwing.
   */
  saveTextDocument: (document: vscode.TextDocument) => Effect.Effect<boolean, DocumentSaveError>
  /**
   * Apply a `WorkspaceEdit` to the workspace. Yields `true` if the edit
   * applied cleanly. Construct edits with `new WorkspaceEdit()` (re-exported
   * from `@jasonkuhrt/vsv/runtime`).
   *
   * The success channel still uses `boolean` because VSCode's `applyEdit`
   * distinguishes "edit accepted but rolled back due to conflicts" (returns
   * `false`) from "API call itself errored" (rejects). The former flows
   * through success; the latter through `WorkspaceEditError`.
   */
  applyEdit: (edit: vscode.WorkspaceEdit) => Effect.Effect<boolean, WorkspaceEditError>
  /**
   * Splice the workspace folder list — add, remove, or replace folders. Wraps
   * `vscode.workspace.updateWorkspaceFolders`, which is *synchronous* and
   * returns `true` if the request was accepted, `false` otherwise (e.g.
   * trying to delete more folders than exist, or invalid args).
   *
   * Effect-wrapped even though VS Code's underlying API is synchronous, so
   * callers can use it uniformly from `Effect.gen`.
   *
   * Single-folder workspaces auto-promote to multi-root the first time this
   * is used to add a folder, which closes and reopens the workspace once.
   * That side-effect is unavoidable.
   */
  updateFolders: (
    start: number,
    deleteCount: number | null | undefined,
    ...workspaceFoldersToAdd: ReadonlyArray<{ readonly uri: vscode.Uri; readonly name?: string }>
  ) => Effect.Effect<boolean>
}

/**
 * Filesystem operations. Wraps `vscode.workspace.fs` — works against any
 * registered file system provider (local, virtual, remote), not just the
 * local OS.
 *
 * Error channel: a union of three tagged errors per operation. High-signal
 * splits get distinct tags so consumers can `Effect.catchTag('FileNotFoundError', ...)`
 * for the common existence-check pattern; the catch-all `FsError` carries
 * everything else with the original error on `cause`.
 */
export interface FsHandle {
  /**
   * List the entries of a directory. Yields `[name, type]` tuples directly
   * from VSCode — no filtering or sort applied.
   */
  readDirectory: (
    uri: vscode.Uri,
  ) => Effect.Effect<ReadonlyArray<[string, vscode.FileType]>, FileNotFoundError | FsError>
  /** Stat a file or directory. Fails with `FileNotFoundError` if the path doesn't exist. */
  stat: (uri: vscode.Uri) => Effect.Effect<vscode.FileStat, FileNotFoundError | FsError>
  /**
   * Read the entire file contents as a `Uint8Array`. Callers typically wrap
   * the result with `new TextDecoder('utf-8').decode(bytes)` for text
   * formats, or pass the bytes through directly for binary.
   *
   * Fails with `FileNotFoundError` if the file does not exist; `FsError`
   * covers permission denied, IO errors, etc. Wraps `vscode.workspace.fs.readFile`
   * so it works against any registered filesystem provider (local, virtual,
   * remote), not just the local OS.
   */
  readFile: (uri: vscode.Uri) => Effect.Effect<Uint8Array, FileNotFoundError | FsError>
  /**
   * Write the file contents from a `Uint8Array`, replacing any existing
   * contents. The parent directory must exist — call `createDirectory`
   * first if you're not sure (it's idempotent and recursive).
   *
   * Fails with `FileNotFoundError` if the parent directory is missing;
   * `FsError` covers permission denied, IO errors, read-only filesystems,
   * etc. Wraps `vscode.workspace.fs.writeFile`.
   */
  writeFile: (
    uri: vscode.Uri,
    content: Uint8Array,
  ) => Effect.Effect<void, FileNotFoundError | FsError>
  /**
   * Create a directory and any missing parents. Idempotent — succeeds
   * silently if the directory already exists.
   *
   * Fails with `FsError` for permission denied, read-only filesystems, etc.
   * Wraps `vscode.workspace.fs.createDirectory` (which is recursive).
   */
  createDirectory: (uri: vscode.Uri) => Effect.Effect<void, FileNotFoundError | FsError>
  /**
   * Rename or move a file/directory. Pass `overwrite: true` for atomic
   * temp-file replacement patterns.
   */
  rename: (
    source: vscode.Uri,
    target: vscode.Uri,
    options?: { readonly overwrite?: boolean },
  ) => Effect.Effect<void, FileNotFoundError | FsError>
  /**
   * Resolve symlinks in `uri` to the on-disk realpath. Yields a new URI.
   *
   * Local-files only: fails with `UnsupportedSchemeError` if `uri.scheme !== 'file'`.
   * There is no portable realpath across the virtual/remote filesystems served
   * by `vscode.workspace.fs`, so this wrapper internally calls Node
   * `fs.promises.realpath`. For remote/virtual URIs the operation is undefined
   * and the wrapper refuses rather than silently misbehaving.
   *
   * Fails with `FileNotFoundError` if the path does not exist **or the symlink
   * target is missing** (broken symlinks throw `ENOENT` from Node fs, which
   * `toFsError` collapses into `FileNotFoundError`). `FsError` covers
   * non-ENOENT failures: permission denied (`EACCES`), too-many-symlinks
   * (`ELOOP`), busy resource (`EBUSY`), etc.
   */
  realpath: (
    uri: vscode.Uri,
  ) => Effect.Effect<vscode.Uri, FileNotFoundError | UnsupportedSchemeError | FsError>
}

/**
 * Window-level UI surfaces that aren't notifications — file/folder pickers,
 * dialogs. Toasts, input boxes, and quick-picks live on `notify` and
 * top-level `quickPick` for now; future versions may consolidate.
 */
export interface WindowHandle {
  /**
   * Show the system file/folder picker. Yields the selected URIs as a
   * readonly array, or `undefined` if the user dismissed the dialog.
   *
   * `canSelectMany: false` (the default) still yields an array; pull the
   * first element if you only want one selection.
   *
   * Wraps `vscode.window.showOpenDialog`. Error channel: `never` — dialog
   * dismissal is a success-channel `undefined`.
   */
  showOpenDialog: (
    options?: ShowOpenDialogOptions,
  ) => Effect.Effect<readonly vscode.Uri[] | undefined>
}

export interface ShowOpenDialogOptions {
  /** URI to open the dialog at. */
  defaultUri?: vscode.Uri
  /** Confirm button label. Defaults to OS-localized "Open". */
  openLabel?: string
  /** Allow selecting files. Default: true. */
  canSelectFiles?: boolean
  /** Allow selecting folders. Default: false. */
  canSelectFolders?: boolean
  /** Allow selecting more than one entry. Default: false. */
  canSelectMany?: boolean
  /** File filters: `{ "Images": ["png", "jpg"], "TypeScript": ["ts"] }`. */
  filters?: { readonly [name: string]: ReadonlyArray<string> }
  /** Dialog title (some platforms only). */
  title?: string
}

/**
 * Active text editor accessor. The editor is `undefined` when focus is on
 * a non-text view (terminal, output, settings, etc.) or no editor exists.
 */
export interface EditorHandle {
  /** Currently focused text editor, or `undefined`. */
  active: () => Effect.Effect<vscode.TextEditor | undefined>
}

/**
 * Editor tab management. Wraps `vscode.window.tabGroups`.
 */
export interface TabsHandle {
  /**
   * All editor tab groups. Each group holds an array of `tabs` — files,
   * diffs, notebooks, terminals, etc. — plus the `activeTab` and
   * `viewColumn`.
   */
  groups: () => Effect.Effect<readonly vscode.TabGroup[]>
  /**
   * Close one or more tabs. Accepts a single tab or array. Yields `true` if
   * all targeted tabs were closed.
   */
  close: (tabs: vscode.Tab | readonly vscode.Tab[]) => Effect.Effect<boolean>
}

/**
 * Status bar surface. Currently exposes transient messaging at the
 * bottom-left status area; persistent items (priority, alignment, command
 * binding) will land here when a consumer needs them.
 */
export interface StatusBarHandle {
  /**
   * Show a transient message in the status bar, auto-clearing after
   * `timeoutMs` (default 1500). Use for command success/failure feedback
   * — anything more than ~3 seconds belongs in a notification, not the
   * status bar.
   *
   * Effect-wrapped for consistency with the rest of the runtime surface.
   */
  message: (text: string, timeoutMs?: number) => Effect.Effect<void>
}

/**
 * Convert an external command's `args` value type (decoded from the manifest's
 * `ExternalCommandDecl`) into the variadic tail of `executeExternalCommand`.
 * The cases:
 *
 * - `void` (nullary command, e.g. `Schema.Void`) → `[]`. Consumer passes only
 *   the id: `rt.executeExternalCommand('moveFileToTrash')`.
 * - Tuple `[A, B, C]` (positional, e.g. `Schema.Tuple(Uri, Position, String)`) →
 *   `[A, B, C]`. Consumer passes positional args:
 *   `rt.executeExternalCommand('vscode.executeDocumentRenameProvider', uri, pos, name)`.
 * - Anything else → `[T]` (single arg). Mostly an escape hatch for `Schema.Unknown`.
 *
 * The `[T] extends [void]` form is the canonical pattern for distinguishing
 * exact `void` from other types in conditional types — `T extends void` is
 * too loose because `undefined extends void` is also true.
 */
type VariadicArgs<T> = [T] extends [void] ? [] : T extends readonly unknown[] ? T : [T]

/**
 * Typed runtime surface for a vsv-managed extension. The single generic
 * `M` is the manifest the runtime was created from — its tuple shape
 * (captured via `defineManifest<const M>`) drives the typing of every
 * method via the mapped-type extractors in `./registries.ts`. Id/key
 * mismatches and value-type mistakes surface at compile time without any
 * codegen step.
 *
 * **Effect-native.** Runtime operations that touch VS Code or host state
 * return `Effect.Effect<A, E>`. Consumer extensions write handlers as
 * `Effect.gen` blocks rather than mixing direct VS Code calls, timers, and
 * `async`/`await`. The runtime bridges to VS Code's sync and Promise APIs at
 * the boundary with `Effect.sync`, `Effect.promise`, and `Effect.tryPromise`.
 */
export interface Runtime<M extends AnyTypedManifest = AnyTypedManifest> {
  /**
   * Register a command handler. The handler is Effect-typed — it returns
   * `Effect.Effect<R, E>`, where `R` matches the command's declared
   * result type and the error channel is open. The runtime bridges to
   * VSCode's Promise-based `commands.registerCommand` at invocation time, so
   * handler errors land as rejected Promises that VSCode propagates to its
   * command-execution failure path.
   *
   * Yields a `Disposable` — push to `context.subscriptions` so VS Code
   * unregisters the command on extension deactivation.
   */
  defineCommand: <Id extends keyof CommandRegistryOf<M> & string>(
    id: Id,
    handler: (args: CommandArgs<M, Id>) => Effect.Effect<CommandResult<M, Id>, unknown>,
  ) => Effect.Effect<vscode.Disposable>

  /**
   * Invoke a command declared in this extension's manifest. The arg shape
   * and return type are derived from the matching `CommandDecl`. For
   * commands outside the manifest, use `executeCommandRaw`.
   */
  executeCommand: <Id extends keyof CommandRegistryOf<M> & string>(
    id: Id,
    args: CommandArgs<M, Id>,
  ) => Effect.Effect<CommandResult<M, Id>, CommandExecutionError>

  /**
   * Invoke a command declared in the manifest's `externalCommands` (typically
   * a VSCode core command). Args are spread into VSCode's variadic
   * `commands.executeCommand(id, ...args)` call, so the args type in the
   * manifest should typically be a tuple matching the command's positional
   * signature.
   *
   * For commands not declared in the manifest, fall back to
   * `executeCommandRaw`. Prefer this typed form when possible — it surfaces
   * id typos, missing manifest entries, and arg-shape mismatches at compile
   * time.
   *
   * The optional second generic `R` lets the caller pin a more specific
   * result type than the manifest declared, which is the common case when
   * the command returns an opaque VSCode runtime value (e.g. `WorkspaceEdit`,
   * `Location`) that can't be expressed as a Schema. The default is the
   * manifest's declared result.
   *
   * @example
   * ```ts
   * // No-arg command, void result:
   * yield* rt.executeExternalCommand('moveFileToTrash')
   *
   * // Positional args, opaque result pinned via second generic:
   * const edit = yield* rt.executeExternalCommand<
   *   'vscode.executeDocumentRenameProvider',
   *   WorkspaceEdit | undefined
   * >('vscode.executeDocumentRenameProvider', uri, position, newName)
   * ```
   */
  executeExternalCommand: <
    Id extends keyof ExternalCommandRegistryOf<M> & string,
    R = ExternalCommandResult<M, Id>,
  >(
    id: Id,
    ...args: VariadicArgs<ExternalCommandArgs<M, Id>>
  ) => Effect.Effect<R, CommandExecutionError>

  /**
   * Untyped escape hatch matching `vscode.commands.executeCommand`. Use when
   * the command isn't in the manifest. Prefer typed alternatives when
   * possible.
   */
  executeCommandRaw: (
    id: string,
    ...args: unknown[]
  ) => Effect.Effect<unknown, CommandExecutionError>

  /**
   * Define a context key. Sets the initial value via VSCode's `setContext`
   * and yields a handle for subsequent updates.
   */
  defineContextKey: <K extends keyof ContextKeyRegistryOf<M> & string>(
    key: K,
    initialValue: ContextKeyValue<M, K>,
  ) => Effect.Effect<ContextKeyHandle<ContextKeyValue<M, K>>>

  /**
   * Define a configuration accessor. The optional `section` scopes reads
   * and writes (e.g. `'editor'` for `editor.foo`); omit for root keys.
   */
  defineConfig: <K extends keyof ConfigRegistryOf<M> & string>(
    key: K,
    section?: string,
  ) => Effect.Effect<ConfigHandle<ConfigValue<M, K>>>

  /**
   * Define a typed accessor for a configuration setting **owned by VSCode
   * core or another extension**. Pass the full dotted key (e.g.
   * `editor.codeLens`); the value type is derived from the matching
   * `ForeignConfigDecl` in the manifest.
   *
   * Distinct from `defineConfig` because foreign settings must NOT be
   * re-contributed in `package.json#contributes.configuration` — doing so
   * would corrupt VSCode's settings UI. Foreign settings are declared via
   * `ForeignConfigDecl` and skipped by the package.json sync.
   */
  defineForeignConfig: <K extends keyof ForeignConfigRegistryOf<M> & string>(
    fullKey: K,
  ) => Effect.Effect<ConfigHandle<ForeignConfigValue<M, K>>>

  /** Define a custom event emitter. */
  defineEvent: <K extends keyof EventRegistryOf<M> & string>(
    key: K,
  ) => Effect.Effect<EventHandle<EventRegistryOf<M>[K]>>

  /**
   * Define a typed accessor over `globalState` or `workspaceState`. The
   * `scope` argument must match the scope declared on the matching
   * `StateDecl` in the manifest — TypeScript enforces this through the
   * manifest-derived `StateScope<M, K>` extractor.
   */
  defineState: <K extends keyof StateRegistryOf<M> & string>(
    context: vscode.ExtensionContext,
    key: K,
    scope: StateScope<M, K>,
  ) => Effect.Effect<StateHandle<StateValue<M, K>>>

  /**
   * Show a `QuickPick` over typed items. Yields the picked item's `value`
   * field, or `undefined` if the user dismissed the picker.
   */
  quickPick: <T>(
    items: ReadonlyArray<QuickPickItem<T>>,
    options?: { placeHolder?: string; canPickMany?: false },
  ) => Effect.Effect<T | undefined>

  /**
   * User-facing notifications — info/warn/error toasts and modal input
   * prompt. Closes the gap left by raw `vscode.window.show*Message` /
   * `showInputBox` calls scattered through extension code.
   */
  notify: NotifyHandle

  /**
   * Status bar messaging. Replaces raw `vscode.window.setStatusBarMessage`
   * calls with a discoverable namespace.
   */
  statusBar: StatusBarHandle

  /**
   * System clipboard read/write. Replaces raw `vscode.env.clipboard.*`
   * calls.
   */
  clipboard: ClipboardHandle

  /**
   * Workspace surface. Folder list + change events + document IO.
   * Filesystem read/write lives on `Runtime.fs`.
   */
  workspace: WorkspaceHandle

  /**
   * Filesystem operations. Replaces raw `vscode.workspace.fs.*` calls.
   */
  fs: FsHandle

  /**
   * Active text editor accessor. Replaces raw
   * `vscode.window.activeTextEditor` reads.
   */
  editor: EditorHandle

  /**
   * Editor tab management. Replaces raw `vscode.window.tabGroups.*` calls.
   */
  tabs: TabsHandle

  /**
   * Window-level UI surfaces — file/folder pickers and other dialogs that
   * aren't notifications. Replaces raw `vscode.window.showOpenDialog` calls.
   */
  window: WindowHandle

  /**
   * Combine multiple disposables into one. Equivalent to
   * `vscode.Disposable.from(...)` but accepts the more permissive
   * `{ dispose }` shape.
   */
  disposables: (...ds: Array<{ dispose: () => void }>) => Effect.Effect<vscode.Disposable>
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — error mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a VSCode `FileSystemError` (or Node `ErrnoException`) thrown by an fs
 * operation into the typed error channel. `FileNotFound` / `ENOENT` get a
 * distinct `FileNotFoundError`; everything else collapses into `FsError` with
 * the original on `cause`.
 *
 * The `code` check covers both VSCode's string codes (`'FileNotFound'`,
 * `'NoPermissions'`, etc.) and Node's errno codes (`'ENOENT'`, `'EACCES'`,
 * etc.) since `realpath` drops to Node's fs module.
 */
const toFsError =
  (uri: vscode.Uri, operation: FsOperation) =>
  (cause: unknown): FileNotFoundError | FsError => {
    // Narrowing `unknown` to `{ code?: unknown }` so we can read the diagnostic
    // code without throwing on null / non-object causes. Lint can't see that
    // optional-chain on the cast covers the null case; the cast lives at the
    // error-translation boundary by design.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    const code = (cause as { code?: unknown } | null)?.code
    if (code === 'FileNotFound' || code === 'ENOENT') {
      return new FileNotFoundError({ uri, operation, cause })
    }
    return new FsError({ uri, operation, cause })
  }

// ─────────────────────────────────────────────────────────────────────────────
// createRuntime — Effect-native runtime
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a typed runtime instance keyed off the consumer's manifest. The
 * manifest's tuple shape (captured via `defineManifest<const M>`) drives
 * the typing of every method — no codegen detour, no generic-list to thread.
 *
 * @example
 * ```ts
 * import manifest from '../vsv.manifest.ts'
 * import { createRuntime } from '@jasonkuhrt/vsv/runtime'
 *
 * const rt = createRuntime(manifest)
 * // rt.defineCommand, rt.defineContextKey, etc. are all typed against
 * // `typeof manifest` directly.
 * ```
 */
export const createRuntime = <M extends AnyTypedManifest = AnyTypedManifest>(
  _manifest: M,
): Runtime<M> => ({
  defineCommand: <Id extends keyof CommandRegistryOf<M> & string>(
    id: Id,
    handler: (args: CommandArgs<M, Id>) => Effect.Effect<CommandResult<M, Id>, unknown>,
  ): Effect.Effect<vscode.Disposable> =>
    Effect.sync(() => {
      // Bridge: vscode.commands.registerCommand expects a thunk that returns a
      // value or Promise. We run the consumer's Effect with
      // `Effect.runPromiseExit` (not `runPromise`) so we can project the Exit's
      // cause into a plain throwable that preserves the original tagged-error
      // identity. Plain `runPromise` rejects with `FiberFailure` wrapping the
      // cause, which loses tag identity for downstream `executeCommand` callers
      // matching on `CommandExecutionError.cause._tag`.
      const thunk = async (args: CommandArgs<M, Id>): Promise<CommandResult<M, Id>> => {
        const exit = await Effect.runPromiseExit(handler(args))
        if (Exit.isSuccess(exit)) return exit.value
        const failure = Cause.failureOption(exit.cause)
        // `Some` -> original Fail<E> error; preserves Data.TaggedError instance
        // identity. `None` -> defect or interrupt, fall back to `Cause.squash`
        // which materializes the cause as a throwable.
        throw failure._tag === 'Some' ? failure.value : Cause.squash(exit.cause)
      }
      return vscode.commands.registerCommand(id, thunk as (...args: unknown[]) => unknown)
    }),

  executeCommand: <Id extends keyof CommandRegistryOf<M> & string>(
    id: Id,
    args: CommandArgs<M, Id>,
  ): Effect.Effect<CommandResult<M, Id>, CommandExecutionError> =>
    Effect.tryPromise({
      // The cast pins vscode's `Thenable<unknown>` to the manifest's declared
      // result type. Lint can't see the manifest guarantee, so the unsafe
      // assertion lives at the API boundary alongside its sibling in
      // executeExternalCommand below.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      try: () => vscode.commands.executeCommand(id, args) as Promise<CommandResult<M, Id>>,
      catch: (cause) => new CommandExecutionError({ id, cause }),
    }),

  executeExternalCommand: <
    Id extends keyof ExternalCommandRegistryOf<M> & string,
    R = ExternalCommandResult<M, Id>,
  >(
    id: Id,
    ...args: VariadicArgs<ExternalCommandArgs<M, Id>>
  ): Effect.Effect<R, CommandExecutionError> =>
    Effect.tryPromise({
      // The cast is the implementation contract: the runtime trusts the
      // manifest's declared result type (or the caller's override `R`). Lint
      // can't see the manifest guarantee, so the unsafe assertion lives at
      // the API boundary.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      try: () => vscode.commands.executeCommand(id, ...args) as Promise<R>,
      catch: (cause) => new CommandExecutionError({ id, cause }),
    }),

  executeCommandRaw: (
    id: string,
    ...args: unknown[]
  ): Effect.Effect<unknown, CommandExecutionError> =>
    Effect.tryPromise({
      try: () => vscode.commands.executeCommand(id, ...args),
      catch: (cause) => new CommandExecutionError({ id, cause }),
    }),

  defineContextKey: <K extends keyof ContextKeyRegistryOf<M> & string>(
    key: K,
    initialValue: ContextKeyValue<M, K>,
  ) =>
    Effect.gen(function* () {
      let current = initialValue
      const listeners = new Set<(v: ContextKeyValue<M, K>) => void>()
      yield* Effect.promise(() => vscode.commands.executeCommand('setContext', key, current))
      return {
        set: (value: ContextKeyValue<M, K>): Effect.Effect<void> =>
          Effect.promise(async () => {
            current = value
            await vscode.commands.executeCommand('setContext', key, value)
            // Each listener runs in isolation: a throwing listener should not
            // prevent siblings from receiving the event, and must not promote
            // the never-typed Effect failure channel into a defect. Errors are
            // logged and swallowed; listeners are observation hooks, not
            // commits, so failure here is non-fatal.
            for (const l of listeners) {
              try {
                l(value)
              } catch (err) {
                console.error(`vsv: context-key '${key}' listener threw`, err)
              }
            }
          }),
        get: (): Effect.Effect<ContextKeyValue<M, K>> => Effect.sync(() => current),
        onChange: (cb: (v: ContextKeyValue<M, K>) => void): Effect.Effect<vscode.Disposable> =>
          Effect.sync(() => {
            listeners.add(cb)
            return {
              dispose: () => {
                listeners.delete(cb)
              },
            }
          }),
      }
    }),

  defineConfig: <K extends keyof ConfigRegistryOf<M> & string>(key: K, section?: string) =>
    Effect.sync(() => {
      const getCfg = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration(section)
      const fullKey = section === undefined ? key : `${section}.${key}`
      type V = ConfigValue<M, K>
      return {
        get: (): Effect.Effect<V | undefined> => Effect.sync(() => getCfg().get<V>(key)),
        getWithDefault: (defaultValue: V): Effect.Effect<V> =>
          Effect.sync(() => getCfg().get<V>(key, defaultValue)),
        update: (
          value: V | undefined,
          target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
        ): Effect.Effect<void, ConfigUpdateError> =>
          Effect.tryPromise({
            try: () => Promise.resolve(getCfg().update(key, value, target)),
            catch: (cause) => new ConfigUpdateError({ key: fullKey, target, cause }),
          }),
        inspect: (): Effect.Effect<ConfigInspection<V> | undefined> =>
          Effect.sync(() => {
            const ins = getCfg().inspect<V>(key)
            if (ins === undefined) return undefined
            const out: ConfigInspection<V> = { key: ins.key }
            if (ins.defaultValue !== undefined) out.defaultValue = ins.defaultValue
            if (ins.globalValue !== undefined) out.globalValue = ins.globalValue
            if (ins.workspaceValue !== undefined) out.workspaceValue = ins.workspaceValue
            if (ins.workspaceFolderValue !== undefined)
              out.workspaceFolderValue = ins.workspaceFolderValue
            return out
          }),
        onChange: (cb: (value: V | undefined) => void): Effect.Effect<vscode.Disposable> =>
          Effect.sync(() =>
            vscode.workspace.onDidChangeConfiguration((e) => {
              if (e.affectsConfiguration(fullKey)) {
                cb(getCfg().get<V>(key))
              }
            }),
          ),
      }
    }),

  // Foreign configs are accessed at the root config level using the full
  // dotted key. This avoids ambiguity for nested settings like
  // `typescript.preferences.useAliasesForRenames` where the section/key split
  // is not unique.
  defineForeignConfig: <K extends keyof ForeignConfigRegistryOf<M> & string>(fullKey: K) =>
    Effect.sync(() => {
      const getCfg = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration()
      type V = ForeignConfigValue<M, K>
      return {
        get: (): Effect.Effect<V | undefined> => Effect.sync(() => getCfg().get<V>(fullKey)),
        getWithDefault: (defaultValue: V): Effect.Effect<V> =>
          Effect.sync(() => getCfg().get<V>(fullKey, defaultValue)),
        update: (
          value: V | undefined,
          target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
        ): Effect.Effect<void, ConfigUpdateError> =>
          Effect.tryPromise({
            try: () => Promise.resolve(getCfg().update(fullKey, value, target)),
            catch: (cause) => new ConfigUpdateError({ key: fullKey, target, cause }),
          }),
        inspect: (): Effect.Effect<ConfigInspection<V> | undefined> =>
          Effect.sync(() => {
            const ins = getCfg().inspect<V>(fullKey)
            if (ins === undefined) return undefined
            const out: ConfigInspection<V> = { key: ins.key }
            if (ins.defaultValue !== undefined) out.defaultValue = ins.defaultValue
            if (ins.globalValue !== undefined) out.globalValue = ins.globalValue
            if (ins.workspaceValue !== undefined) out.workspaceValue = ins.workspaceValue
            if (ins.workspaceFolderValue !== undefined)
              out.workspaceFolderValue = ins.workspaceFolderValue
            return out
          }),
        onChange: (cb: (value: V | undefined) => void): Effect.Effect<vscode.Disposable> =>
          Effect.sync(() =>
            vscode.workspace.onDidChangeConfiguration((e) => {
              if (e.affectsConfiguration(fullKey)) {
                cb(getCfg().get<V>(fullKey))
              }
            }),
          ),
      }
    }),

  defineEvent: <K extends keyof EventRegistryOf<M> & string>(_key: K) =>
    Effect.sync(() => {
      type V = EventRegistryOf<M>[K]
      const emitter = new vscode.EventEmitter<V>()
      return {
        fire: (value: V): Effect.Effect<void> =>
          Effect.sync(() => {
            emitter.fire(value)
          }),
        event: (listener: (value: V) => void): Effect.Effect<vscode.Disposable> =>
          Effect.sync(() => emitter.event(listener)),
        dispose: (): Effect.Effect<void> =>
          Effect.sync(() => {
            emitter.dispose()
          }),
      }
    }),

  defineState: <K extends keyof StateRegistryOf<M> & string>(
    context: vscode.ExtensionContext,
    key: K,
    scope: StateScope<M, K>,
  ) =>
    Effect.sync(() => {
      const memento = scope === 'global' ? context.globalState : context.workspaceState
      type V = StateValue<M, K>
      return {
        get: (): Effect.Effect<V | undefined> => Effect.sync(() => memento.get<V>(key)),
        getWithDefault: (defaultValue: V): Effect.Effect<V> =>
          Effect.sync(() => memento.get<V>(key, defaultValue)),
        set: (value: V): Effect.Effect<void, StateUpdateError> =>
          Effect.tryPromise({
            try: () => Promise.resolve(memento.update(key, value)),
            catch: (cause) => new StateUpdateError({ key, operation: 'set', cause }),
          }),
        delete: (): Effect.Effect<void, StateUpdateError> =>
          Effect.tryPromise({
            try: () => Promise.resolve(memento.update(key, undefined)),
            catch: (cause) => new StateUpdateError({ key, operation: 'delete', cause }),
          }),
      }
    }),

  quickPick: <T>(
    items: ReadonlyArray<QuickPickItem<T>>,
    options?: { placeHolder?: string; canPickMany?: false },
  ): Effect.Effect<T | undefined> =>
    Effect.promise(async () => {
      const pickable: vscode.QuickPickItem[] = items.map((item) => {
        const entry: vscode.QuickPickItem = { label: item.label }
        if (item.description !== undefined) entry.description = item.description
        if (item.detail !== undefined) entry.detail = item.detail
        return entry
      })
      const pickOptions: vscode.QuickPickOptions = { canPickMany: false }
      if (options?.placeHolder !== undefined) pickOptions.placeHolder = options.placeHolder
      const picked = await vscode.window.showQuickPick(pickable, pickOptions)
      if (picked === undefined) return undefined
      const match = items.find((i) => i.label === picked.label)
      return match?.value
    }),

  notify: {
    info: (text: string, ...actions: ReadonlyArray<string>): Effect.Effect<string | undefined> =>
      Effect.promise(() => Promise.resolve(vscode.window.showInformationMessage(text, ...actions))),
    warn: (text: string, ...actions: ReadonlyArray<string>): Effect.Effect<string | undefined> =>
      Effect.promise(() => Promise.resolve(vscode.window.showWarningMessage(text, ...actions))),
    error: (text: string, ...actions: ReadonlyArray<string>): Effect.Effect<string | undefined> =>
      Effect.promise(() => Promise.resolve(vscode.window.showErrorMessage(text, ...actions))),
    prompt: (options: PromptOptions): Effect.Effect<string | undefined> =>
      Effect.promise(() => {
        // Build the vscode-shaped options object incrementally — passing
        // `undefined` values explicitly trips strict optional-property checks
        // on `vscode.InputBoxOptions`.
        const vscodeOpts: vscode.InputBoxOptions = { prompt: options.prompt }
        if (options.value !== undefined) vscodeOpts.value = options.value
        if (options.valueSelection !== undefined) vscodeOpts.valueSelection = options.valueSelection
        if (options.placeHolder !== undefined) vscodeOpts.placeHolder = options.placeHolder
        if (options.password !== undefined) vscodeOpts.password = options.password
        return Promise.resolve(vscode.window.showInputBox(vscodeOpts))
      }),
  },

  statusBar: {
    message: (text: string, timeoutMs: number = 1500): Effect.Effect<void> =>
      Effect.sync(() => {
        vscode.window.setStatusBarMessage(text, timeoutMs)
      }),
  },

  clipboard: {
    readText: (): Effect.Effect<string, ClipboardError> =>
      Effect.tryPromise({
        try: () => vscode.env.clipboard.readText(),
        catch: (cause) => new ClipboardError({ operation: 'readText', cause }),
      }),
    writeText: (text: string): Effect.Effect<void, ClipboardError> =>
      Effect.tryPromise({
        try: () => vscode.env.clipboard.writeText(text),
        catch: (cause) => new ClipboardError({ operation: 'writeText', cause }),
      }),
  },

  workspace: {
    folders: (): Effect.Effect<readonly vscode.WorkspaceFolder[] | undefined> =>
      Effect.sync(() => vscode.workspace.workspaceFolders),
    onDidChangeFolders: (
      cb: (e: vscode.WorkspaceFoldersChangeEvent) => void,
    ): Effect.Effect<vscode.Disposable> =>
      Effect.sync(() => vscode.workspace.onDidChangeWorkspaceFolders(cb)),
    onDidChangeTextDocument: (
      cb: (e: vscode.TextDocumentChangeEvent) => void,
    ): Effect.Effect<vscode.Disposable> =>
      Effect.sync(() => vscode.workspace.onDidChangeTextDocument(cb)),
    openTextDocument: (
      target: vscode.Uri | string,
    ): Effect.Effect<vscode.TextDocument, DocumentOpenError> =>
      Effect.tryPromise({
        // The Uri / string overloads of vscode.workspace.openTextDocument can't
        // be unified through a `Uri | string` parameter — the typed call has to
        // dispatch per-shape.
        try: () =>
          typeof target === 'string'
            ? vscode.workspace.openTextDocument(target)
            : vscode.workspace.openTextDocument(target),
        catch: (cause) => new DocumentOpenError({ target, cause }),
      }),
    saveTextDocument: (document: vscode.TextDocument): Effect.Effect<boolean, DocumentSaveError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(document.save()),
        catch: (cause) => new DocumentSaveError({ uri: document.uri, cause }),
      }),
    applyEdit: (edit: vscode.WorkspaceEdit): Effect.Effect<boolean, WorkspaceEditError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.applyEdit(edit)),
        catch: (cause) => new WorkspaceEditError({ cause }),
      }),
    updateFolders: (
      start: number,
      deleteCount: number | null | undefined,
      ...adds: ReadonlyArray<{ readonly uri: vscode.Uri; readonly name?: string }>
    ): Effect.Effect<boolean> =>
      Effect.sync(() => vscode.workspace.updateWorkspaceFolders(start, deleteCount, ...adds)),
  },

  fs: {
    readDirectory: (
      uri: vscode.Uri,
    ): Effect.Effect<ReadonlyArray<[string, vscode.FileType]>, FileNotFoundError | FsError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.fs.readDirectory(uri)),
        catch: toFsError(uri, 'readDirectory'),
      }),
    stat: (uri: vscode.Uri): Effect.Effect<vscode.FileStat, FileNotFoundError | FsError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.fs.stat(uri)),
        catch: toFsError(uri, 'stat'),
      }),
    readFile: (uri: vscode.Uri): Effect.Effect<Uint8Array, FileNotFoundError | FsError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.fs.readFile(uri)),
        catch: toFsError(uri, 'readFile'),
      }),
    writeFile: (
      uri: vscode.Uri,
      content: Uint8Array,
    ): Effect.Effect<void, FileNotFoundError | FsError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.fs.writeFile(uri, content)),
        catch: toFsError(uri, 'writeFile'),
      }),
    createDirectory: (uri: vscode.Uri): Effect.Effect<void, FileNotFoundError | FsError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.fs.createDirectory(uri)),
        catch: toFsError(uri, 'createDirectory'),
      }),
    rename: (
      source: vscode.Uri,
      target: vscode.Uri,
      options?: { readonly overwrite?: boolean },
    ): Effect.Effect<void, FileNotFoundError | FsError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.fs.rename(source, target, options)),
        catch: toFsError(source, 'rename'),
      }),
    realpath: (
      uri: vscode.Uri,
    ): Effect.Effect<vscode.Uri, FileNotFoundError | UnsupportedSchemeError | FsError> => {
      // vscode.workspace.fs has no realpath operation, so we drop to Node fs
      // for local files. Refuse non-file schemes rather than silently
      // misbehave on virtual/remote URIs.
      if (uri.scheme !== 'file') {
        return Effect.fail(
          new UnsupportedSchemeError({ uri, operation: 'realpath', expectedScheme: 'file' }),
        )
      }
      return Effect.tryPromise({
        try: async () => {
          const resolved = await fs.promises.realpath(uri.fsPath)
          return vscode.Uri.file(resolved)
        },
        catch: toFsError(uri, 'realpath'),
      })
    },
  },

  editor: {
    active: (): Effect.Effect<vscode.TextEditor | undefined> =>
      Effect.sync(() => vscode.window.activeTextEditor),
  },

  tabs: {
    groups: (): Effect.Effect<readonly vscode.TabGroup[]> =>
      Effect.sync(() => vscode.window.tabGroups.all),
    close: (tabs: vscode.Tab | readonly vscode.Tab[]): Effect.Effect<boolean> =>
      Effect.promise(() => {
        // VSCode's `close` doesn't accept readonly arrays — materialize a
        // fresh mutable array when given one. Single-tab callers stay zero-copy.
        if (Array.isArray(tabs)) {
          return vscode.window.tabGroups.close((tabs as readonly vscode.Tab[]).slice())
        }
        return vscode.window.tabGroups.close(tabs)
      }),
  },

  window: {
    showOpenDialog: (
      options?: ShowOpenDialogOptions,
    ): Effect.Effect<readonly vscode.Uri[] | undefined> =>
      Effect.promise(() => {
        // Build the vscode-shaped options object incrementally — passing
        // `undefined` values explicitly trips strict optional-property checks
        // on `vscode.OpenDialogOptions`. Same pattern as `notify.prompt`.
        const vscodeOpts: vscode.OpenDialogOptions = {}
        if (options?.defaultUri !== undefined) vscodeOpts.defaultUri = options.defaultUri
        if (options?.openLabel !== undefined) vscodeOpts.openLabel = options.openLabel
        if (options?.canSelectFiles !== undefined)
          vscodeOpts.canSelectFiles = options.canSelectFiles
        if (options?.canSelectFolders !== undefined) {
          vscodeOpts.canSelectFolders = options.canSelectFolders
        }
        if (options?.canSelectMany !== undefined) vscodeOpts.canSelectMany = options.canSelectMany
        if (options?.filters !== undefined) {
          // Filter values are mutable arrays in VSCode's type; copy through.
          vscodeOpts.filters = Object.fromEntries(
            Object.entries(options.filters).map(([k, v]) => [k, [...v]]),
          )
        }
        if (options?.title !== undefined) vscodeOpts.title = options.title
        return Promise.resolve(vscode.window.showOpenDialog(vscodeOpts))
      }),
  },

  disposables: (...ds: Array<{ dispose: () => void }>): Effect.Effect<vscode.Disposable> =>
    Effect.sync(() => vscode.Disposable.from(...(ds as vscode.Disposable[]))),
})
