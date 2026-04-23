import * as vscode from 'vscode'

export type CommandRegistryShape = Record<string, { args: unknown; result: unknown }>
export type ContextKeyRegistryShape = Record<string, unknown>
export type ConfigRegistryShape = Record<string, unknown>
export type StateRegistryShape = Record<string, { value: unknown; scope: 'global' | 'workspace' }>
export type EventRegistryShape = Record<string, unknown>

export interface ContextKeyHandle<V> {
  set: (value: V) => Promise<void>
  get: () => V
  onChange: (cb: (value: V) => void) => vscode.Disposable
}

export interface ConfigHandle<V> {
  get: () => V | undefined
  getWithDefault: (defaultValue: V) => V
  update: (value: V, target?: vscode.ConfigurationTarget) => Promise<void>
  onChange: (cb: (value: V | undefined) => void) => vscode.Disposable
}

export interface StateHandle<V> {
  get: () => V | undefined
  set: (value: V) => Promise<void>
  delete: () => Promise<void>
}

export interface EventHandle<V> {
  fire: (value: V) => void
  event: (listener: (value: V) => void) => vscode.Disposable
  dispose: () => void
}

export interface QuickPickItem<T> {
  label: string
  description?: string
  detail?: string
  value: T
}

export interface Runtime<
  CR extends CommandRegistryShape = CommandRegistryShape,
  CKR extends ContextKeyRegistryShape = ContextKeyRegistryShape,
  CFR extends ConfigRegistryShape = ConfigRegistryShape,
  SR extends StateRegistryShape = StateRegistryShape,
  ER extends EventRegistryShape = EventRegistryShape,
> {
  defineCommand: <Id extends keyof CR & string>(
    id: Id,
    handler: (args: CR[Id]['args']) => Promise<CR[Id]['result']> | CR[Id]['result'],
  ) => vscode.Disposable

  executeCommand: <Id extends keyof CR & string>(
    id: Id,
    args: CR[Id]['args'],
  ) => Promise<CR[Id]['result']>

  executeCommandRaw: (id: string, ...args: unknown[]) => Promise<unknown>

  defineContextKey: <K extends keyof CKR & string>(
    key: K,
    initialValue: CKR[K],
  ) => ContextKeyHandle<CKR[K]>

  defineConfig: <K extends keyof CFR & string>(key: K, section?: string) => ConfigHandle<CFR[K]>

  defineEvent: <K extends keyof ER & string>(key: K) => EventHandle<ER[K]>

  defineState: <K extends keyof SR & string>(
    context: vscode.ExtensionContext,
    key: K,
    scope: SR[K]['scope'],
  ) => StateHandle<SR[K]['value']>

  quickPick: <T>(
    items: ReadonlyArray<QuickPickItem<T>>,
    options?: { placeHolder?: string; canPickMany?: false },
  ) => Promise<T | undefined>

  disposables: (...ds: Array<{ dispose: () => void }>) => vscode.Disposable
}

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
