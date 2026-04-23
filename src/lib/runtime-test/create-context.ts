import type { ExtensionContext, Memento } from 'vscode'

type MementoWithSync = Memento & { setKeysForSync: (keys: readonly string[]) => void }

const createMockMemento = (): MementoWithSync => {
  const store = new Map<string, unknown>()
  function get<T>(key: string): T | undefined
  function get<T>(key: string, defaultValue: T): T
  function get<T>(key: string, defaultValue?: T): T | undefined {
    if (store.has(key)) return store.get(key) as T
    return defaultValue
  }
  const memento: MementoWithSync = {
    get,
    update: async (key: string, value: unknown): Promise<void> => {
      store.set(key, value)
    },
    keys: (): readonly string[] => Array.from(store.keys()),
    setKeysForSync: (): void => {},
  }
  return memento
}

export interface TestExtensionContext {
  subscriptions: Array<{ dispose: () => void }>
  globalState: Memento
  workspaceState: Memento
  extensionUri: { fsPath: string; toString: () => string }
  extensionPath: string
  storageUri: { fsPath: string; toString: () => string }
  globalStorageUri: { fsPath: string; toString: () => string }
  logUri: { fsPath: string; toString: () => string }
}

export const createTestExtensionContext = (): ExtensionContext & TestExtensionContext => {
  const mock = {
    subscriptions: [] as Array<{ dispose: () => void }>,
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
      persistent: true,
      description: undefined,
      replace: (): void => {},
      append: (): void => {},
      prepend: (): void => {},
      get: (): undefined => undefined,
      forEach: (): void => {},
      delete: (): void => {},
      clear: (): void => {},
      getScoped: (): unknown => ({}),
      [Symbol.iterator]: function* (): Iterator<[string, unknown]> {},
    },
    asAbsolutePath: (relativePath: string): string => `/test/${relativePath}`,
    extensionMode: 2,
    storagePath: '/test/storage',
    globalStoragePath: '/test/globalStorage',
    logPath: '/test/log',
  }
  return mock as unknown as ExtensionContext & TestExtensionContext
}
