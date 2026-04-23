interface MockMemento {
  get<T>(key: string): T | undefined
  get<T>(key: string, defaultValue: T): T
  update(key: string, value: unknown): Promise<void>
  keys(): readonly string[]
}

const createMockMemento = (): MockMemento => {
  const store = new Map<string, unknown>()
  function get<T>(key: string): T | undefined
  function get<T>(key: string, defaultValue: T): T
  function get<T>(key: string, defaultValue?: T): T | undefined {
    if (store.has(key)) return store.get(key) as T
    return defaultValue
  }
  return {
    get,
    update: async (key: string, value: unknown): Promise<void> => {
      store.set(key, value)
    },
    keys: (): readonly string[] => Array.from(store.keys()),
  }
}

export interface TestExtensionContext {
  subscriptions: Array<{ dispose: () => void }>
  globalState: MockMemento
  workspaceState: MockMemento
  extensionUri: { fsPath: string; toString: () => string }
  extensionPath: string
  storageUri: { fsPath: string; toString: () => string }
  globalStorageUri: { fsPath: string; toString: () => string }
  logUri: { fsPath: string; toString: () => string }
  environmentVariableCollection: {
    replace: (variable: string, value: string) => void
    append: (variable: string, value: string) => void
    prepend: (variable: string, value: string) => void
    get: (variable: string) => unknown
    forEach: (callback: (variable: string, mutator: unknown) => void) => void
    delete: (variable: string) => void
    clear: () => void
  }
}

export const createTestExtensionContext = (): TestExtensionContext => {
  return {
    subscriptions: [],
    globalState: createMockMemento(),
    workspaceState: createMockMemento(),
    extensionUri: { fsPath: '/test', toString: () => 'file:///test' },
    extensionPath: '/test',
    storageUri: { fsPath: '/test/storage', toString: () => 'file:///test/storage' },
    globalStorageUri: {
      fsPath: '/test/globalStorage',
      toString: () => 'file:///test/globalStorage',
    },
    logUri: { fsPath: '/test/log', toString: () => 'file:///test/log' },
    environmentVariableCollection: {
      replace: () => {},
      append: () => {},
      prepend: () => {},
      get: () => undefined,
      forEach: () => {},
      delete: () => {},
      clear: () => {},
    },
  }
}
