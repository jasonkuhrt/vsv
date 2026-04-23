type CommandHandler = (...args: unknown[]) => unknown

interface ExecutedCommand {
  id: string
  args: unknown[]
}

interface ConfigurationChange {
  section: string
  key: string
  value: unknown
  target: number
}

interface MockState {
  registeredCommands: Map<string, CommandHandler>
  executedCommands: ExecutedCommand[]
  contextKeys: Map<string, unknown>
  configuration: Map<string, unknown>
  configurationChanges: ConfigurationChange[]
  shownQuickPicks: unknown[]
  nextQuickPickResult: unknown
  shownMessages: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
}

const state: MockState = {
  registeredCommands: new Map(),
  executedCommands: [],
  contextKeys: new Map(),
  configuration: new Map(),
  configurationChanges: [],
  shownQuickPicks: [],
  nextQuickPickResult: undefined,
  shownMessages: [],
}

export const commands = {
  registerCommand: (id: string, handler: CommandHandler) => {
    state.registeredCommands.set(id, handler)
    return {
      dispose: () => {
        state.registeredCommands.delete(id)
      },
    }
  },
  executeCommand: async (id: string, ...args: unknown[]): Promise<unknown> => {
    state.executedCommands.push({ id, args })
    if (id === 'setContext') {
      const key = args[0]
      const value = args[1]
      if (typeof key === 'string') {
        state.contextKeys.set(key, value)
      }
      return undefined
    }
    const handler = state.registeredCommands.get(id)
    if (handler) {
      return await handler(...args)
    }
    return undefined
  },
  getCommands: async (_filterInternal?: boolean): Promise<string[]> => {
    return Array.from(state.registeredCommands.keys())
  },
}

interface WorkspaceConfiguration {
  get: <T>(key: string, defaultValue?: T) => T | undefined
  has: (key: string) => boolean
  update: (key: string, value: unknown, target?: number) => Promise<void>
}

export const workspace = {
  getConfiguration: (section?: string): WorkspaceConfiguration => {
    const prefix = section === undefined ? '' : `${section}.`
    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const fullKey = `${prefix}${key}`
        if (state.configuration.has(fullKey)) {
          return state.configuration.get(fullKey) as T
        }
        return defaultValue
      },
      has: (key: string): boolean => {
        return state.configuration.has(`${prefix}${key}`)
      },
      update: async (key: string, value: unknown, target?: number): Promise<void> => {
        const fullKey = `${prefix}${key}`
        state.configuration.set(fullKey, value)
        state.configurationChanges.push({
          section: section ?? '',
          key,
          value,
          target: target ?? ConfigurationTarget.Workspace,
        })
      },
    }
  },
  onDidChangeConfiguration: (_listener: (e: unknown) => unknown) => {
    return { dispose: () => {} }
  },
}

export const window = {
  showQuickPick: async (items: unknown, opts?: unknown): Promise<unknown> => {
    state.shownQuickPicks.push({ items, opts })
    return state.nextQuickPickResult
  },
  showInformationMessage: async (
    message: string,
    ..._items: string[]
  ): Promise<string | undefined> => {
    state.shownMessages.push({ level: 'info', message })
    return undefined
  },
  showWarningMessage: async (message: string, ..._items: string[]): Promise<string | undefined> => {
    state.shownMessages.push({ level: 'warn', message })
    return undefined
  },
  showErrorMessage: async (message: string, ..._items: string[]): Promise<string | undefined> => {
    state.shownMessages.push({ level: 'error', message })
    return undefined
  },
}

type EventListener<T> = (value: T) => unknown

export class EventEmitter<T> {
  private listeners = new Set<EventListener<T>>()

  readonly event = (listener: EventListener<T>) => {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}

export class Disposable {
  constructor(public callOnDispose: () => void) {}

  dispose(): void {
    this.callOnDispose()
  }

  static from(...disposables: Array<{ dispose: () => void }>): Disposable {
    return new Disposable(() => {
      for (const d of disposables) {
        d.dispose()
      }
    })
  }
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const

export const __state = {
  reset: (): void => {
    state.registeredCommands.clear()
    state.executedCommands = []
    state.contextKeys.clear()
    state.configuration.clear()
    state.configurationChanges = []
    state.shownQuickPicks = []
    state.nextQuickPickResult = undefined
    state.shownMessages = []
  },
  getRegisteredCommands: (): string[] => Array.from(state.registeredCommands.keys()),
  getExecutedCommands: (): ReadonlyArray<ExecutedCommand> => [...state.executedCommands],
  getContextKeys: (): Readonly<Record<string, unknown>> => Object.fromEntries(state.contextKeys),
  getConfiguration: (): Readonly<Record<string, unknown>> =>
    Object.fromEntries(state.configuration),
  getConfigurationChanges: (): ReadonlyArray<ConfigurationChange> => [
    ...state.configurationChanges,
  ],
  getShownQuickPicks: (): ReadonlyArray<unknown> => [...state.shownQuickPicks],
  getShownMessages: (): ReadonlyArray<{ level: 'info' | 'warn' | 'error'; message: string }> => [
    ...state.shownMessages,
  ],
  setConfiguration: (entries: Readonly<Record<string, unknown>>): void => {
    for (const [k, v] of Object.entries(entries)) {
      state.configuration.set(k, v)
    }
  },
  setContextKey: (key: string, value: unknown): void => {
    state.contextKeys.set(key, value)
  },
  setNextQuickPickResult: (value: unknown): void => {
    state.nextQuickPickResult = value
  },
}
