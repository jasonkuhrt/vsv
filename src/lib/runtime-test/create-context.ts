import { Effect } from 'effect';
import type { Memento } from 'vscode';
import { Uri } from './vscode-mock.ts';

interface SharedMemento extends Memento {
  readonly setKeysForSync: (keys: ReadonlyArray<string>) => void;
}

const createMemento = (): SharedMemento => {
  const store = new Map<string, unknown>();
  function get<T>(key: string): T | undefined;
  function get<T>(key: string, defaultValue: T): T;
  function get(key: string, defaultValue?: unknown): unknown {
    return store.has(key) ? store.get(key) : defaultValue;
  }
  return {
    get,
    update: (key, value) =>
      Effect.runPromise(
        Effect.sync(() => {
          if (value === undefined) {
            store.delete(key);
          } else {
            store.set(key, value);
          }
        }),
      ),
    keys: () => [...store.keys()],
    setKeysForSync: () => {},
  };
};

export interface TestExtensionContext {
  readonly subscriptions: Array<{ dispose: () => void }>;
  readonly globalState: SharedMemento;
  readonly workspaceState: Memento;
  readonly extensionUri: Uri;
  readonly extensionPath: string;
  readonly storageUri: Uri;
  readonly globalStorageUri: Uri;
  readonly logUri: Uri;
}

export const createTestExtensionContext = (): TestExtensionContext => ({
  subscriptions: [],
  globalState: createMemento(),
  workspaceState: createMemento(),
  extensionUri: Uri.file('/test'),
  extensionPath: '/test',
  storageUri: Uri.file('/test/storage'),
  globalStorageUri: Uri.file('/test/globalStorage'),
  logUri: Uri.file('/test/log'),
});
