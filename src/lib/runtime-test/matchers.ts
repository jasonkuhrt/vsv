import { expect } from 'bun:test'
import type { InstalledMock } from './install-mock.ts'

interface MatcherResult {
  pass: boolean
  message: () => string
}

const asMock = (received: unknown): InstalledMock => received as InstalledMock

expect.extend({
  toHaveRegisteredCommand(received: unknown, id: string): MatcherResult {
    const mock = asMock(received)
    const ids = mock.state.getRegisteredCommands()
    const pass = ids.includes(id)
    return {
      pass,
      message: (): string =>
        pass
          ? `Expected vscode mock not to have registered command "${id}"`
          : `Expected vscode mock to have registered command "${id}", got [${ids.join(', ')}]`,
    }
  },

  toHaveExecutedCommand(received: unknown, id: string): MatcherResult {
    const mock = asMock(received)
    const executed = mock.state.getExecutedCommands()
    const pass = executed.some((e) => e.id === id)
    return {
      pass,
      message: (): string =>
        pass
          ? `Expected vscode mock not to have executed command "${id}"`
          : `Expected vscode mock to have executed command "${id}", got [${executed.map((e) => e.id).join(', ')}]`,
    }
  },

  toHaveContextKey(received: unknown, key: string, value?: unknown): MatcherResult {
    const mock = asMock(received)
    const keys = mock.state.getContextKeys()
    const has = Object.hasOwn(keys, key)
    if (value === undefined) {
      return {
        pass: has,
        message: (): string =>
          has
            ? `Expected vscode mock not to have context key "${key}"`
            : `Expected vscode mock to have context key "${key}", got [${Object.keys(keys).join(', ')}]`,
      }
    }
    const pass = has && keys[key] === value
    return {
      pass,
      message: (): string =>
        pass
          ? `Expected vscode mock not to have context key "${key}" = ${String(value)}`
          : `Expected vscode mock to have context key "${key}" = ${String(value)}, got ${String(keys[key])}`,
    }
  },
})

declare module 'bun:test' {
  interface Matchers<T> {
    toHaveRegisteredCommand(id: string): T
    toHaveExecutedCommand(id: string): T
    toHaveContextKey(key: string, value?: unknown): T
  }
}
