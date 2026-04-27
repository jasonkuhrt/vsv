import * as vscode from 'vscode'

/**
 * Shape of the `CommandRegistry` map produced by codegen from the manifest's
 * `commands` array. Each key is a command id; each value pairs the command's
 * argument and result types. Used as the constraint on `Runtime`'s `CR`
 * generic so `defineCommand`/`executeCommand` can index by id.
 */
export type CommandRegistryShape = Record<string, { args: unknown; result: unknown }>

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
 * Typed runtime surface for a vsv-managed extension. Created via
 * `createRuntime<CR, CKR, CFR, SR, ER>()` where each generic corresponds to
 * a generated `*Registry` type. Methods are indexed by the registries so
 * id/key mismatches and value-type mistakes surface at compile time.
 *
 * Most extensions only thread the first one or two generics; defaults
 * (`*RegistryShape`) widen to permissive untyped maps when omitted.
 */
export interface Runtime<
  CR extends CommandRegistryShape = CommandRegistryShape,
  CKR extends ContextKeyRegistryShape = ContextKeyRegistryShape,
  CFR extends ConfigRegistryShape = ConfigRegistryShape,
  SR extends StateRegistryShape = StateRegistryShape,
  ER extends EventRegistryShape = EventRegistryShape,
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
   * Untyped escape hatch matching `vscode.commands.executeCommand`. Use when
   * the command isn't in `CommandRegistry` (e.g. VS Code core commands not
   * declared as `ExternalCommandDecl`). Prefer typed alternatives when
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
 * } from './generated/registries.ts'
 *
 * const rt = createRuntime<CommandRegistry, ContextKeyRegistry, never, StateRegistry>()
 * ```
 */
export const createRuntime = <
  CR extends CommandRegistryShape = CommandRegistryShape,
  CKR extends ContextKeyRegistryShape = ContextKeyRegistryShape,
  CFR extends ConfigRegistryShape = ConfigRegistryShape,
  SR extends StateRegistryShape = StateRegistryShape,
  ER extends EventRegistryShape = EventRegistryShape,
>(): Runtime<CR, CKR, CFR, SR, ER> => ({
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

  disposables: (...ds: Array<{ dispose: () => void }>): vscode.Disposable =>
    vscode.Disposable.from(...(ds as vscode.Disposable[])),
})
