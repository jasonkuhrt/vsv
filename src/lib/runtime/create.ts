import { Effect } from 'effect'
import * as fs from 'node:fs'
import * as vscode from 'vscode'
import {
  ClipboardError,
  CommandExecutionError,
  ConfigUpdateError,
  DocumentOpenError,
  FileNotFoundError,
  FsError,
  StateUpdateError,
  UnsupportedSchemeError,
  WorkspaceEditError,
} from './errors.ts'

/**
 * Shape of the `CommandRegistry` map produced by codegen from the manifest's
 * `commands` array. Each key is a command id; each value pairs the command's
 * argument and result types. Used as the constraint on `Runtime`'s `CR`
 * generic so `defineCommand`/`executeCommand` can index by id.
 */
export type CommandRegistryShape = Record<string, { args: unknown; result: unknown }>

/**
 * Shape of the `ExternalCommandRegistry` map produced by codegen from the
 * manifest's `externalCommands` array. Each key is a command id (typically a
 * VSCode core command name like `revealInExplorer` or
 * `vscode.executeDocumentRenameProvider`); each value pairs the command's
 * argument and result types. Drives `executeExternalCommand`'s typing.
 *
 * Args should typically be a tuple matching the command's positional
 * signature (e.g. `[Uri, Position, string]` for `executeDocumentRenameProvider`),
 * which `executeExternalCommand` will spread into VSCode's variadic
 * `commands.executeCommand(id, ...args)` call. `Schema.Void` is also valid
 * for nullary commands.
 */
export type ExternalCommandRegistryShape = Record<string, { args: unknown; result: unknown }>

/**
 * Shape of the `ContextKeyRegistry` map produced by codegen. Maps a context
 * key name to its value type. Drives `defineContextKey`'s value typing.
 */
export type ContextKeyRegistryShape = Record<string, unknown>

/**
 * Shape of the `ConfigRegistry` map produced by codegen. Maps a configuration
 * key (as contributed in `package.json#contributes.configuration`) to its
 * value type. Drives `defineConfig`'s value typing.
 */
export type ConfigRegistryShape = Record<string, unknown>

/**
 * Shape of the `ForeignConfigRegistry` map produced by codegen from the
 * manifest's `foreignConfig` array. Maps a foreign setting's full dotted
 * key (e.g. `editor.codeLens`, `explorer.confirmDelete`) to its value type.
 * Drives `defineForeignConfig`'s value typing.
 *
 * Foreign configs are NOT synced into `package.json#contributes.configuration`
 * — re-contributing a built-in or third-party setting would corrupt VSCode's
 * settings UI. Use foreign configs to type-safely read/write settings the
 * extension does not own.
 */
export type ForeignConfigRegistryShape = Record<string, unknown>

/**
 * Shape of the `StateRegistry` map produced by codegen. Each entry pairs a
 * value type with its memento scope (`'global'` or `'workspace'`). Drives
 * `defineState`'s value and scope typing.
 */
export type StateRegistryShape = Record<string, { value: unknown; scope: 'global' | 'workspace' }>

/**
 * Shape of the `EventRegistry` map produced by codegen. Maps an event name
 * to its payload type. Drives `defineEvent`'s payload typing.
 */
export type EventRegistryShape = Record<string, unknown>

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
  get: () => V
  /** Subscribe to changes set through this handle. Returns a disposable. */
  onChange: (cb: (value: V) => void) => vscode.Disposable
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
  get: () => V | undefined
  /** Read the current value, falling back to `defaultValue` if unset. */
  getWithDefault: (defaultValue: V) => V
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
  inspect: () => ConfigInspection<V> | undefined
  /** Subscribe to changes for this specific key. Returns a disposable. */
  onChange: (cb: (value: V | undefined) => void) => vscode.Disposable
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
  get: () => V | undefined
  /** Read the current value, falling back to `defaultValue` if unset. */
  getWithDefault: (defaultValue: V) => V
  /** Persist a new value. Yields after the memento write completes. */
  set: (value: V) => Effect.Effect<void, StateUpdateError>
  /** Remove the value from the memento. */
  delete: () => Effect.Effect<void, StateUpdateError>
}

/**
 * Handle to a custom event. Returned by `runtime.defineEvent(key)`.
 *
 * Wraps a `vscode.EventEmitter`. Use for cross-module pub/sub within the
 * extension; for VS Code's own events (file system, editor, etc.), use the
 * `vscode.workspace.onDid*` APIs directly.
 *
 * All three operations are sync — no Promise/Effect wrapping needed.
 */
export interface EventHandle<V> {
  /** Emit a value to all subscribers. Synchronous. */
  fire: (value: V) => void
  /** Subscribe. Returns a disposable that unsubscribes on dispose. */
  event: (listener: (value: V) => void) => vscode.Disposable
  /** Dispose the underlying emitter. Subscribers stop receiving events. */
  dispose: () => void
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
 * extension prompts (no validation callback yet; call `vscode.window.showInputBox`
 * directly if you need that until vsv exposes it).
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
  /** Show a non-blocking informational message. Bottom-right toast. */
  info: (text: string) => Effect.Effect<string | undefined>
  /** Show a non-blocking warning message. Bottom-right toast with warning icon. */
  warn: (text: string) => Effect.Effect<string | undefined>
  /** Show a non-blocking error message. Bottom-right toast with error icon. */
  error: (text: string) => Effect.Effect<string | undefined>
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
  readonly folders: readonly vscode.WorkspaceFolder[] | undefined
  /**
   * Subscribe to workspace folder add/remove events. Returns a disposable.
   */
  onDidChangeFolders: (cb: (e: vscode.WorkspaceFoldersChangeEvent) => void) => vscode.Disposable
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
   * **Stays sync.** VSCode's underlying API is synchronous and never throws;
   * wrapping in `Effect.sync` would lie about the cost model. Callers in
   * `Effect.gen` blocks call this directly without `yield*`.
   *
   * Single-folder workspaces auto-promote to multi-root the first time this
   * is used to add a folder, which closes and reopens the workspace once.
   * That side-effect is unavoidable.
   */
  updateFolders: (
    start: number,
    deleteCount: number | null | undefined,
    ...workspaceFoldersToAdd: ReadonlyArray<{ readonly uri: vscode.Uri; readonly name?: string }>
  ) => boolean
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
   * Resolve symlinks in `uri` to the on-disk realpath. Yields a new URI.
   *
   * Local-files only: fails with `UnsupportedSchemeError` if `uri.scheme !== 'file'`.
   * There is no portable realpath across the virtual/remote filesystems served
   * by `vscode.workspace.fs`, so this wrapper internally calls Node
   * `fs.promises.realpath`. For remote/virtual URIs the operation is undefined
   * and the wrapper refuses rather than silently misbehaving.
   *
   * Fails with `FileNotFoundError` if the path does not exist; `FsError`
   * (cause: `ENOENT` chain or other Node `errno`) for broken symlinks and
   * permission failures.
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
  readonly active: vscode.TextEditor | undefined
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
  readonly groups: readonly vscode.TabGroup[]
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
   * Stays sync — VSCode's underlying call is sync and can't fail.
   */
  message: (text: string, timeoutMs?: number) => void
}

/**
 * Convert an `ExternalCommandRegistry[Id]['args']` shape into the variadic
 * tail of `executeExternalCommand`. The cases:
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
type ExternalCommandArgs<T> = [T] extends [void] ? [] : T extends readonly unknown[] ? T : [T]

/**
 * Typed runtime surface for a vsv-managed extension. Created via
 * `createRuntime<CR, CKR, CFR, SR, ER, EXR>()` where each generic corresponds
 * to a generated `*Registry` type. Methods are indexed by the registries so
 * id/key mismatches and value-type mistakes surface at compile time.
 *
 * **Effect-native.** Every async operation returns
 * `Effect.Effect<A, E>`. Consumer extensions write handlers as
 * `Effect.gen` blocks rather than `async`/`await`. The runtime bridges to
 * VSCode's Promise-based API at the boundary via `Effect.tryPromise`.
 *
 * Sync getters and pure operations stay sync — the migration only touches
 * Promise-returning surfaces. Specifically: `editor.active`,
 * `workspace.folders`, `tabs.groups`, `ConfigHandle.get/getWithDefault/inspect/onChange`,
 * `StateHandle.get/getWithDefault`, `ContextKeyHandle.get/onChange`,
 * `EventHandle.{fire,event,dispose}`, `statusBar.message`,
 * `workspace.updateFolders`, `disposables`, and `defineCommand`'s return
 * (a `vscode.Disposable`) all stay sync.
 *
 * Most extensions only thread the first one or two generics; defaults
 * (`*RegistryShape`) widen to permissive untyped maps when omitted. Pass
 * `ExternalCommandRegistry` as the 6th generic to enable typed
 * `executeExternalCommand` against built-in/foreign commands declared in
 * the manifest's `externalCommands`.
 */
export interface Runtime<
  CR extends CommandRegistryShape = CommandRegistryShape,
  CKR extends ContextKeyRegistryShape = ContextKeyRegistryShape,
  CFR extends ConfigRegistryShape = ConfigRegistryShape,
  SR extends StateRegistryShape = StateRegistryShape,
  ER extends EventRegistryShape = EventRegistryShape,
  EXR extends ExternalCommandRegistryShape = ExternalCommandRegistryShape,
  FCR extends ForeignConfigRegistryShape = ForeignConfigRegistryShape,
> {
  /**
   * Register a command handler. The handler is Effect-typed — it returns
   * `Effect.Effect<R, E>`, where `R` matches the command's declared
   * result type and the error channel is open. The runtime bridges to
   * VSCode's Promise-based `commands.registerCommand` via `Effect.runPromise`
   * at invocation time, so handler errors land as rejected Promises that
   * VSCode propagates to its command-execution failure path.
   *
   * Returns a `Disposable` — push to `context.subscriptions` so VS Code
   * unregisters the command on extension deactivation.
   */
  defineCommand: <Id extends keyof CR & string>(
    id: Id,
    handler: (args: CR[Id]['args']) => Effect.Effect<CR[Id]['result'], unknown>,
  ) => vscode.Disposable

  /**
   * Invoke a command from this extension's `CommandRegistry`. The arg shape
   * and return type are constrained by the registry entry. For commands
   * outside the registry, use `executeCommandRaw` or call
   * `vscode.commands.executeCommand` directly.
   */
  executeCommand: <Id extends keyof CR & string>(
    id: Id,
    args: CR[Id]['args'],
  ) => Effect.Effect<CR[Id]['result'], CommandExecutionError>

  /**
   * Invoke a command declared in the manifest's `externalCommands` (typically
   * a VSCode core command). Args are spread into VSCode's variadic
   * `commands.executeCommand(id, ...args)` call, so the args type in the
   * manifest should typically be a tuple matching the command's positional
   * signature.
   *
   * For commands not declared in any registry, fall back to
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
  executeExternalCommand: <Id extends keyof EXR & string, R = EXR[Id]['result']>(
    id: Id,
    ...args: ExternalCommandArgs<EXR[Id]['args']>
  ) => Effect.Effect<R, CommandExecutionError>

  /**
   * Untyped escape hatch matching `vscode.commands.executeCommand`. Use when
   * the command isn't in any registry. Prefer typed alternatives when
   * possible.
   */
  executeCommandRaw: (
    id: string,
    ...args: unknown[]
  ) => Effect.Effect<unknown, CommandExecutionError>

  /**
   * Define a context key. Sets the initial value via VSCode's `setContext`
   * (fire-and-forget — VSCode updates internal state synchronously before
   * the IPC roundtrip completes) and returns a handle for subsequent updates.
   */
  defineContextKey: <K extends keyof CKR & string>(
    key: K,
    initialValue: CKR[K],
  ) => ContextKeyHandle<CKR[K]>

  /**
   * Define a configuration accessor. The optional `section` scopes reads
   * and writes (e.g. `'editor'` for `editor.foo`); omit for root keys.
   */
  defineConfig: <K extends keyof CFR & string>(key: K, section?: string) => ConfigHandle<CFR[K]>

  /**
   * Define a typed accessor for a configuration setting **owned by VSCode
   * core or another extension**. Pass the full dotted key (e.g.
   * `editor.codeLens`); the value type is looked up from
   * `ForeignConfigRegistry`.
   *
   * Distinct from `defineConfig` because foreign settings must NOT be
   * re-contributed in `package.json#contributes.configuration` — doing so
   * would corrupt VSCode's settings UI. Foreign settings are declared via
   * `ForeignConfigDecl` and skipped by the package.json sync.
   */
  defineForeignConfig: <K extends keyof FCR & string>(fullKey: K) => ConfigHandle<FCR[K]>

  /** Define a custom event emitter. */
  defineEvent: <K extends keyof ER & string>(key: K) => EventHandle<ER[K]>

  /**
   * Define a typed accessor over `globalState` or `workspaceState`. The
   * `scope` argument must match the scope declared on the matching
   * `StateDecl` in the manifest — TypeScript enforces this through the
   * `StateRegistry` entry.
   */
  defineState: <K extends keyof SR & string>(
    context: vscode.ExtensionContext,
    key: K,
    scope: SR[K]['scope'],
  ) => StateHandle<SR[K]['value']>

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
  disposables: (...ds: Array<{ dispose: () => void }>) => vscode.Disposable
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
  (uri: vscode.Uri, operation: 'readDirectory' | 'stat' | 'realpath') =>
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
 * Create a typed runtime instance. Pass the generated `*Registry` types as
 * generics — typically only the first one or two are needed. Omitted
 * generics fall back to permissive untyped maps.
 *
 * @example
 * ```ts
 * import type {
 *   CommandRegistry,
 *   ContextKeyRegistry,
 *   StateRegistry,
 *   ExternalCommandRegistry,
 * } from './generated/registries.ts'
 *
 * const rt = createRuntime<
 *   CommandRegistry,
 *   ContextKeyRegistry,
 *   never,
 *   StateRegistry,
 *   never,
 *   ExternalCommandRegistry
 * >()
 * ```
 */
export const createRuntime = <
  CR extends CommandRegistryShape = CommandRegistryShape,
  CKR extends ContextKeyRegistryShape = ContextKeyRegistryShape,
  CFR extends ConfigRegistryShape = ConfigRegistryShape,
  SR extends StateRegistryShape = StateRegistryShape,
  ER extends EventRegistryShape = EventRegistryShape,
  EXR extends ExternalCommandRegistryShape = ExternalCommandRegistryShape,
  FCR extends ForeignConfigRegistryShape = ForeignConfigRegistryShape,
>(): Runtime<CR, CKR, CFR, SR, ER, EXR, FCR> => ({
  defineCommand: <Id extends keyof CR & string>(
    id: Id,
    handler: (args: CR[Id]['args']) => Effect.Effect<CR[Id]['result'], unknown>,
  ): vscode.Disposable => {
    // Bridge: vscode.commands.registerCommand expects a thunk that returns a
    // value or Promise. Run the consumer's Effect with `Effect.runPromise` so
    // failures surface as rejected Promises (VSCode's command-failure path).
    const thunk = (args: CR[Id]['args']): Promise<CR[Id]['result']> =>
      Effect.runPromise(handler(args))
    return vscode.commands.registerCommand(id, thunk as (...args: unknown[]) => unknown)
  },

  executeCommand: <Id extends keyof CR & string>(
    id: Id,
    args: CR[Id]['args'],
  ): Effect.Effect<CR[Id]['result'], CommandExecutionError> =>
    Effect.tryPromise({
      // The cast pins vscode's `Thenable<unknown>` to the registry's declared
      // result type. Lint can't see the registry guarantee, so the unsafe
      // assertion lives at the API boundary alongside its sibling in
      // executeExternalCommand below.
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      try: () => vscode.commands.executeCommand(id, args) as Promise<CR[Id]['result']>,
      catch: (cause) => new CommandExecutionError({ id, cause }),
    }),

  executeExternalCommand: <Id extends keyof EXR & string, R = EXR[Id]['result']>(
    id: Id,
    ...args: ExternalCommandArgs<EXR[Id]['args']>
  ): Effect.Effect<R, CommandExecutionError> =>
    Effect.tryPromise({
      // The cast is the implementation contract: the runtime trusts the
      // manifest's declared result type (or the caller's override `R`). Lint
      // can't see the registry guarantee, so the unsafe assertion lives at
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

  defineContextKey: <K extends keyof CKR & string>(key: K, initialValue: CKR[K]) => {
    let current = initialValue
    const listeners = new Set<(v: CKR[K]) => void>()
    // Fire-and-forget the initial setContext. VSCode updates context state
    // synchronously inside the executeCommand body before the IPC roundtrip
    // resolves, so subsequent reads of the key see `initialValue` even though
    // we don't `yield*` here.
    void vscode.commands.executeCommand('setContext', key, current)
    return {
      set: (value: CKR[K]): Effect.Effect<void> =>
        Effect.promise(async () => {
          current = value
          await vscode.commands.executeCommand('setContext', key, value)
          for (const l of listeners) {
            l(value)
          }
        }),
      get: (): CKR[K] => current,
      onChange: (cb: (v: CKR[K]) => void): vscode.Disposable => {
        listeners.add(cb)
        return {
          dispose: () => {
            listeners.delete(cb)
          },
        }
      },
    }
  },

  defineConfig: <K extends keyof CFR & string>(key: K, section?: string) => {
    const getCfg = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration(section)
    const fullKey = section === undefined ? key : `${section}.${key}`
    return {
      get: (): CFR[K] | undefined => getCfg().get<CFR[K]>(key),
      getWithDefault: (defaultValue: CFR[K]): CFR[K] => getCfg().get<CFR[K]>(key, defaultValue),
      update: (
        value: CFR[K] | undefined,
        target: vscode.ConfigurationTarget = 2 /* Workspace */ as vscode.ConfigurationTarget,
      ): Effect.Effect<void, ConfigUpdateError> =>
        Effect.tryPromise({
          try: () => Promise.resolve(getCfg().update(key, value, target)),
          catch: (cause) => new ConfigUpdateError({ key: fullKey, target, cause }),
        }),
      inspect: (): ConfigInspection<CFR[K]> | undefined => {
        const ins = getCfg().inspect<CFR[K]>(key)
        if (ins === undefined) return undefined
        const out: ConfigInspection<CFR[K]> = { key: ins.key }
        if (ins.defaultValue !== undefined) out.defaultValue = ins.defaultValue
        if (ins.globalValue !== undefined) out.globalValue = ins.globalValue
        if (ins.workspaceValue !== undefined) out.workspaceValue = ins.workspaceValue
        if (ins.workspaceFolderValue !== undefined)
          out.workspaceFolderValue = ins.workspaceFolderValue
        return out
      },
      onChange: (cb: (value: CFR[K] | undefined) => void): vscode.Disposable => {
        return vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration(fullKey)) {
            cb(getCfg().get<CFR[K]>(key))
          }
        })
      },
    }
  },

  // Foreign configs are accessed at the root config level using the full
  // dotted key. This avoids ambiguity for nested settings like
  // `typescript.preferences.useAliasesForRenames` where the section/key split
  // is not unique.
  defineForeignConfig: <K extends keyof FCR & string>(fullKey: K) => {
    const getCfg = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration()
    return {
      get: (): FCR[K] | undefined => getCfg().get<FCR[K]>(fullKey),
      getWithDefault: (defaultValue: FCR[K]): FCR[K] => getCfg().get<FCR[K]>(fullKey, defaultValue),
      update: (
        value: FCR[K] | undefined,
        target: vscode.ConfigurationTarget = 2 /* Workspace */ as vscode.ConfigurationTarget,
      ): Effect.Effect<void, ConfigUpdateError> =>
        Effect.tryPromise({
          try: () => Promise.resolve(getCfg().update(fullKey, value, target)),
          catch: (cause) => new ConfigUpdateError({ key: fullKey, target, cause }),
        }),
      inspect: (): ConfigInspection<FCR[K]> | undefined => {
        const ins = getCfg().inspect<FCR[K]>(fullKey)
        if (ins === undefined) return undefined
        const out: ConfigInspection<FCR[K]> = { key: ins.key }
        if (ins.defaultValue !== undefined) out.defaultValue = ins.defaultValue
        if (ins.globalValue !== undefined) out.globalValue = ins.globalValue
        if (ins.workspaceValue !== undefined) out.workspaceValue = ins.workspaceValue
        if (ins.workspaceFolderValue !== undefined)
          out.workspaceFolderValue = ins.workspaceFolderValue
        return out
      },
      onChange: (cb: (value: FCR[K] | undefined) => void): vscode.Disposable => {
        return vscode.workspace.onDidChangeConfiguration((e) => {
          if (e.affectsConfiguration(fullKey)) {
            cb(getCfg().get<FCR[K]>(fullKey))
          }
        })
      },
    }
  },

  defineEvent: <K extends keyof ER & string>(_key: K) => {
    const emitter = new vscode.EventEmitter<ER[K]>()
    return {
      fire: (value: ER[K]): void => {
        emitter.fire(value)
      },
      event: (listener: (value: ER[K]) => void): vscode.Disposable => emitter.event(listener),
      dispose: (): void => {
        emitter.dispose()
      },
    }
  },

  defineState: <K extends keyof SR & string>(
    context: vscode.ExtensionContext,
    key: K,
    scope: SR[K]['scope'],
  ) => {
    const memento = scope === 'global' ? context.globalState : context.workspaceState
    return {
      get: (): SR[K]['value'] | undefined => memento.get<SR[K]['value']>(key),
      getWithDefault: (defaultValue: SR[K]['value']): SR[K]['value'] =>
        memento.get<SR[K]['value']>(key, defaultValue),
      set: (value: SR[K]['value']): Effect.Effect<void, StateUpdateError> =>
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
  },

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
    info: (text: string): Effect.Effect<string | undefined> =>
      Effect.promise(() => Promise.resolve(vscode.window.showInformationMessage(text))),
    warn: (text: string): Effect.Effect<string | undefined> =>
      Effect.promise(() => Promise.resolve(vscode.window.showWarningMessage(text))),
    error: (text: string): Effect.Effect<string | undefined> =>
      Effect.promise(() => Promise.resolve(vscode.window.showErrorMessage(text))),
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
    message: (text: string, timeoutMs: number = 1500): void => {
      vscode.window.setStatusBarMessage(text, timeoutMs)
    },
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
    get folders(): readonly vscode.WorkspaceFolder[] | undefined {
      return vscode.workspace.workspaceFolders
    },
    onDidChangeFolders: (cb: (e: vscode.WorkspaceFoldersChangeEvent) => void): vscode.Disposable =>
      vscode.workspace.onDidChangeWorkspaceFolders(cb),
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
    applyEdit: (edit: vscode.WorkspaceEdit): Effect.Effect<boolean, WorkspaceEditError> =>
      Effect.tryPromise({
        try: () => Promise.resolve(vscode.workspace.applyEdit(edit)),
        catch: (cause) => new WorkspaceEditError({ cause }),
      }),
    updateFolders: (
      start: number,
      deleteCount: number | null | undefined,
      ...adds: ReadonlyArray<{ readonly uri: vscode.Uri; readonly name?: string }>
    ): boolean => vscode.workspace.updateWorkspaceFolders(start, deleteCount, ...adds),
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
    get active(): vscode.TextEditor | undefined {
      return vscode.window.activeTextEditor
    },
  },

  tabs: {
    get groups(): readonly vscode.TabGroup[] {
      return vscode.window.tabGroups.all
    },
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

  disposables: (...ds: Array<{ dispose: () => void }>): vscode.Disposable =>
    vscode.Disposable.from(...(ds as vscode.Disposable[])),
})
