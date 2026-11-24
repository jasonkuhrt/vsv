import { expect } from 'bun:test';
import { Array, Formatter, Record } from 'effect';
import { InstalledMock } from './install-mock.ts';

const invalidReceiver = (): MatcherResult => ({
  pass: false,
  message: () => 'Expected a vsv VS Code test fixture',
});

interface MatcherResult {
  pass: boolean;
  message: () => string;
}

export const registerMatchers = () => {
  expect.extend({
    toHaveRegisteredCommand(received: unknown, id: string): MatcherResult {
      if (!(received instanceof InstalledMock)) return invalidReceiver();
      const mock = received;
      const ids = mock.state.getRegisteredCommands();
      const pass = Array.contains(ids, id);
      return {
        pass,
        message: (): string =>
          pass
            ? `Expected vscode mock not to have registered command "${id}"`
            : `Expected vscode mock to have registered command "${id}", got [${Array.join(ids, ', ')}]`,
      };
    },

    toHaveExecutedCommand(received: unknown, id: string): MatcherResult {
      if (!(received instanceof InstalledMock)) return invalidReceiver();
      const mock = received;
      const executed = mock.state.getExecutedCommands();
      const pass = Array.some(executed, (e) => e.id === id);
      return {
        pass,
        message: (): string =>
          pass
            ? `Expected vscode mock not to have executed command "${id}"`
            : `Expected vscode mock to have executed command "${id}", got [${Array.join(
                Array.map(executed, (e) => e.id),
                ', ',
              )}]`,
      };
    },

    toHaveContextKey(
      received: unknown,
      key: string,
      value?: unknown,
    ): MatcherResult {
      if (!(received instanceof InstalledMock)) return invalidReceiver();
      const mock = received;
      const keys = mock.state.getContextKeys();
      const has = Record.has(keys, key);
      if (value === undefined) {
        return {
          pass: has,
          message: (): string =>
            has
              ? `Expected vscode mock not to have context key "${key}"`
              : `Expected vscode mock to have context key "${key}", got [${Array.join(Record.keys(keys), ', ')}]`,
        };
      }
      const pass = has && keys[key] === value;
      return {
        pass,
        message: (): string =>
          pass
            ? `Expected vscode mock not to have context key "${key}" = ${Formatter.format(value)}`
            : `Expected vscode mock to have context key "${key}" = ${Formatter.format(value)}, got ${Formatter.format(keys[key])}`,
      };
    },
  });
};

declare module 'bun:test' {
  interface Matchers<T> {
    toHaveRegisteredCommand(id: string): T;
    toHaveExecutedCommand(id: string): T;
    toHaveContextKey(key: string, value?: unknown): T;
  }
}
