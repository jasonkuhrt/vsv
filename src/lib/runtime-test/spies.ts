import { Array, Effect, Record } from 'effect';
import type { InstalledMock } from './install-mock.ts';

export interface CommandSpy {
  getExecutions: () => ReadonlyArray<{ id: string; args: unknown[] }>;
  getExecutionsFor: (
    id: string,
  ) => ReadonlyArray<{ id: string; args: unknown[] }>;
}

export const spyOnCommands = (mock: InstalledMock): CommandSpy => ({
  getExecutions: () => mock.state.getExecutedCommands(),
  getExecutionsFor: (id: string) =>
    Array.filter(mock.state.getExecutedCommands(), (entry) => entry.id === id),
});

export const withContextKeys = <A, E, R>(
  mock: InstalledMock,
  keys: Readonly<Record<string, unknown>>,
  program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prior = mock.state.getContextKeys();
      for (const [key, value] of Record.toEntries(keys))
        mock.state.setContextKey(key, value);
      return prior;
    }),
    () => program,
    (prior) =>
      Effect.sync(() => {
        for (const key of Record.keys(keys)) {
          if (Record.has(prior, key)) {
            mock.state.setContextKey(key, prior[key]);
          } else {
            mock.state.deleteContextKey(key);
          }
        }
      }),
  );
