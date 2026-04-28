import * as vscode from 'vscode'

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
 */
export interface ContextKeyHandle<V> {
  /** Update the context key. Awaits VS Code's `setContext` propagation. */
  set: (value: V) => Promise<void>
  /** Read the most recent value set through this handle (cached locally). */
  get: () => V
  /** Subscribe to changes set through this handle. Returns a disposable. */
  onChange: (cb: (value: V) => void) => vscode.Disposable
}

/**
 * Handle to a configuration setting. Returned by
 * `runtime.defineConfig(key, section?)`.
 *
 * Reads/writes are scoped to the optional `section` (e.g. `'editor'`); if
 * omitted, reads use the root configuration. Updates default to workspace
 * target — pass an explicit `ConfigurationTarget` to write to user/global.
 */
export interface ConfigHandle<V> {
  /** Read the current value. Returns `undefined` if not set anywhere. */
  get: () => V | undefined
  /** Read the current value, falling back to `defaultValue` if unset. */
  getWithDefault: (defaultValue: V) => V
  /** Update the value. Defaults to `Workspace` target. */
  update: (value: V, target?: vscode.ConfigurationTarget) => Promise<void>
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
 */
export interface StateHandle<V> {
  /** Read the current value. Returns `undefined` if never set. */
  get: () => V | undefined
  /** Read the current value, falling back to `defaultValue` if unset. */
  getWithDefault: (defaultValue: V) => V
  /** Persist a new value. Awaits memento write. */
  set: (value: V) => Promise<void>
  /** Remove the value from the memento. */
  delete: () => Promise<void>
}

/**
 * Handle to a custom event. Returned by `runtime.defineEvent(key)`.
 *
 * Wraps a `vscode.EventEmitter`. Use for cross-module pub/sub within the
 * extension; for VS Code's own events (file system, editor, etc.), use the
 * `vscode.workspace.onDid*` APIs directly.
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
 * return promises that resolve when the notification is dismissed. For
 * `info`/`warn`/`error`, the resolved value is the action button label
 * the user clicked, or `undefined` if dismissed without action.
 *
 * Future: button overloads for action-bearing notifications, modal vs
 * non-modal flag.
 */
export interface NotifyHandle {
  /** Show a non-blocking informational message. Bottom-right toast. */
  info: (text: string) => Promise<string | undefined>
  /** Show a non-blocking warning message. Bottom-right toast with warning icon. */
  warn: (text: string) => Promise<string | undefined>
  /** Show a non-blocking error message. Bottom-right toast with error icon. */
  error: (text: string) => Promise<string | undefined>
  /**
   * Show an input box at the top of the window. Returns the entered text,
   * or `undefined` if the user dismissed without confirming.
   */
  prompt: (options: PromptOptions) => Promise<string | undefined>
}

/**
 * System clipboard. Wraps `vscode.env.clipboard`. Both methods are async
 * because OS clipboard access goes through async IPC under the hood.
 *
 * Common pattern: snapshot/restore for clipboard-roundtrip workarounds
 * (e.g. invoking a built-in command that places focused-resource info on
 * the clipboard, then reading it without disturbing the user's copy).
 */
export interface ClipboardHandle {
  /** Read the current clipboard text contents. Empty string if clipboard is non-text. */
  readText: () => Promise<string>
  /** Replace the clipboard text contents. Does not preserve previous content. */
  writeText: (text: string) => Promise<void>
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
   * Open a text document by URI or filesystem path. Returns the
   * `TextDocument` (cached if already open). Use this to load file
   * contents for inspection or editing without showing the document in
   * the editor.
   */
  openTextDocument: (target: vscode.Uri | string) => Promise<vscode.TextDocument>
  /**
   * Apply a `WorkspaceEdit` to the workspace. Returns `true` if the edit
   * applied cleanly. Construct edits with `new WorkspaceEdit()` (re-exported
   * from `@jasonkuhrt/vsv/runtime`).
   */
  applyEdit: (edit: vscode.WorkspaceEdit) => Promise<boolean>
}

/**
 * Filesystem operations. Wraps `vscode.workspace.fs` — works against any
 * registered file system provider (local, virtual, remote), not just the
 * local OS. Errors throw as `vscode.FileSystemError` instances; consumers
 * typically `try/catch` per-operation.
 */
export interface FsHandle {
  /**
   * List the entries of a directory. Returns `[name, type]` tuples
   * directly from VSCode — no filtering or sort applied.
   */
  readDirectory: (uri: vscode.Uri) => Promise<ReadonlyArray<[string, vscode.FileType]>>
  /** Stat a file or directory. Throws if the path doesn't exist. */
  stat: (uri: vscode.Uri) => Promise<vscode.FileStat>
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
   * Close one or more tabs. Accepts a single tab or array. Returns `true`
   * if all targeted tabs were closed.
   */
  close: (tabs: vscode.Tab | readonly vscode.Tab[]) => Promise<boolean>
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
> {
  /**
   * Register a command handler. The handler's argument and return types are
   * constrained by the manifest's `CommandDecl` for this id.
   *
   * Returns a `Disposable` — push to `context.subscriptions` so VS Code
   * unregisters the command on extension deactivation.
   */
  defineCommand: <Id extends keyof CR & string>(
    id: Id,
    handler: (args: CR[Id]['args']) => Promise<CR[Id]['result']> | CR[Id]['result'],
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
  ) => Promise<CR[Id]['result']>

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
   * await rt.executeExternalCommand('moveFileToTrash')
   *
   * // Positional args, opaque result pinned via second generic:
   * const edit = await rt.executeExternalCommand<
   *   'vscode.executeDocumentRenameProvider',
   *   WorkspaceEdit | undefined
   * >('vscode.executeDocumentRenameProvider', uri, position, newName)
   * ```
   */
  executeExternalCommand: <Id extends keyof EXR & string, R = EXR[Id]['result']>(
    id: Id,
    ...args: ExternalCommandArgs<EXR[Id]['args']>
  ) => Promise<R>

  /**
   * Untyped escape hatch matching `vscode.commands.executeCommand`. Use when
   * the command isn't in any registry. Prefer typed alternatives when
   * possible.
   */
  executeCommandRaw: (id: string, ...args: unknown[]) => Promise<unknown>

  /**
   * Define a context key. Sets the initial value synchronously via VS Code's
   * `setContext` and returns a handle for subsequent updates.
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
   * Show a `QuickPick` over typed items. Returns the picked item's `value`
   * field, or `undefined` if the user dismissed the picker.
   */
  quickPick: <T>(
    items: ReadonlyArray<QuickPickItem<T>>,
    options?: { placeHolder?: string; canPickMany?: false },
  ) => Promise<T | undefined>

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
   * Combine multiple disposables into one. Equivalent to
   * `vscode.Disposable.from(...)` but accepts the more permissive
   * `{ dispose }` shape.
   */
  disposables: (...ds: Array<{ dispose: () => void }>) => vscode.Disposable
}

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
>(): Runtime<CR, CKR, CFR, SR, ER, EXR> => ({
  defineCommand: <Id extends keyof CR & string>(
    id: Id,
    handler: (args: CR[Id]['args']) => Promise<CR[Id]['result']> | CR[Id]['result'],
  ): vscode.Disposable =>
    vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown),

  executeCommand: async <Id extends keyof CR & string>(
    id: Id,
    args: CR[Id]['args'],
  ): Promise<CR[Id]['result']> => {
    const result = await vscode.commands.executeCommand(id, args)
    return result as CR[Id]['result']
  },

  executeExternalCommand: async <Id extends keyof EXR & string, R = EXR[Id]['result']>(
    id: Id,
    ...args: ExternalCommandArgs<EXR[Id]['args']>
  ): Promise<R> => {
    const result = await vscode.commands.executeCommand(id, ...args)
    // The cast is the implementation contract: the runtime trusts the
    // manifest's declared result type (or the caller's override `R`). Lint
    // can't see the registry guarantee, so suppress the single unsafe
    // assertion at the API boundary.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return result as R
  },

  executeCommandRaw: async (id: string, ...args: unknown[]): Promise<unknown> =>
    vscode.commands.executeCommand(id, ...args),

  defineContextKey: <K extends keyof CKR & string>(key: K, initialValue: CKR[K]) => {
    let current = initialValue
    const listeners = new Set<(v: CKR[K]) => void>()
    void vscode.commands.executeCommand('setContext', key, current)
    return {
      set: async (value: CKR[K]): Promise<void> => {
        current = value
        await vscode.commands.executeCommand('setContext', key, value)
        for (const l of listeners) {
          l(value)
        }
      },
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
    return {
      get: (): CFR[K] | undefined => getCfg().get<CFR[K]>(key),
      getWithDefault: (defaultValue: CFR[K]): CFR[K] => getCfg().get<CFR[K]>(key, defaultValue),
      update: async (
        value: CFR[K],
        target: vscode.ConfigurationTarget = 2 /* Workspace */ as vscode.ConfigurationTarget,
      ): Promise<void> => {
        await getCfg().update(key, value, target)
      },
      onChange: (cb: (value: CFR[K] | undefined) => void): vscode.Disposable => {
        return vscode.workspace.onDidChangeConfiguration((e) => {
          const effectiveSection = section === undefined ? key : `${section}.${key}`
          if (e.affectsConfiguration(effectiveSection)) {
            cb(getCfg().get<CFR[K]>(key))
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
      set: async (value: SR[K]['value']): Promise<void> => {
        await memento.update(key, value)
      },
      delete: async (): Promise<void> => {
        await memento.update(key, undefined)
      },
    }
  },

  quickPick: async <T>(
    items: ReadonlyArray<QuickPickItem<T>>,
    options?: { placeHolder?: string; canPickMany?: false },
  ): Promise<T | undefined> => {
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
  },

  notify: {
    info: async (text: string): Promise<string | undefined> =>
      vscode.window.showInformationMessage(text),
    warn: async (text: string): Promise<string | undefined> =>
      vscode.window.showWarningMessage(text),
    error: async (text: string): Promise<string | undefined> =>
      vscode.window.showErrorMessage(text),
    prompt: async (options: PromptOptions): Promise<string | undefined> => {
      // Build the vscode-shaped options object incrementally — passing
      // `undefined` values explicitly trips strict optional-property checks
      // on `vscode.InputBoxOptions`.
      const vscodeOpts: vscode.InputBoxOptions = { prompt: options.prompt }
      if (options.value !== undefined) vscodeOpts.value = options.value
      if (options.valueSelection !== undefined) vscodeOpts.valueSelection = options.valueSelection
      if (options.placeHolder !== undefined) vscodeOpts.placeHolder = options.placeHolder
      if (options.password !== undefined) vscodeOpts.password = options.password
      return vscode.window.showInputBox(vscodeOpts)
    },
  },

  statusBar: {
    message: (text: string, timeoutMs: number = 1500): void => {
      vscode.window.setStatusBarMessage(text, timeoutMs)
    },
  },

  clipboard: {
    readText: async (): Promise<string> => vscode.env.clipboard.readText(),
    writeText: async (text: string): Promise<void> => vscode.env.clipboard.writeText(text),
  },

  workspace: {
    get folders(): readonly vscode.WorkspaceFolder[] | undefined {
      return vscode.workspace.workspaceFolders
    },
    onDidChangeFolders: (cb: (e: vscode.WorkspaceFoldersChangeEvent) => void): vscode.Disposable =>
      vscode.workspace.onDidChangeWorkspaceFolders(cb),
    openTextDocument: async (target: vscode.Uri | string): Promise<vscode.TextDocument> => {
      // The Uri / string overloads of vscode.workspace.openTextDocument can't
      // be unified through a `Uri | string` parameter — the typed call has to
      // dispatch per-shape.
      return typeof target === 'string'
        ? vscode.workspace.openTextDocument(target)
        : vscode.workspace.openTextDocument(target)
    },
    applyEdit: async (edit: vscode.WorkspaceEdit): Promise<boolean> =>
      vscode.workspace.applyEdit(edit),
  },

  fs: {
    readDirectory: async (uri: vscode.Uri): Promise<ReadonlyArray<[string, vscode.FileType]>> =>
      vscode.workspace.fs.readDirectory(uri),
    stat: async (uri: vscode.Uri): Promise<vscode.FileStat> => vscode.workspace.fs.stat(uri),
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
    close: async (tabs: vscode.Tab | readonly vscode.Tab[]): Promise<boolean> => {
      // VSCode's `close` doesn't accept readonly arrays — materialize a
      // fresh mutable array when given one. Single-tab callers stay zero-copy.
      if (Array.isArray(tabs)) {
        return vscode.window.tabGroups.close((tabs as readonly vscode.Tab[]).slice())
      }
      return vscode.window.tabGroups.close(tabs)
    },
  },

  disposables: (...ds: Array<{ dispose: () => void }>): vscode.Disposable =>
    vscode.Disposable.from(...(ds as vscode.Disposable[])),
})
