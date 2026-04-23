import type { InstalledMock } from './install-mock.ts'

export interface CommandSpy {
  getExecutions: () => ReadonlyArray<{ id: string; args: unknown[] }>
  getExecutionsFor: (id: string) => ReadonlyArray<{ id: string; args: unknown[] }>
}

export const spyOnCommands = (mock: InstalledMock): CommandSpy => {
  return {
    getExecutions: () => mock.state.getExecutedCommands(),
    getExecutionsFor: (id: string) => mock.state.getExecutedCommands().filter((e) => e.id === id),
  }
}

export const withContextKeys = async (
  mock: InstalledMock,
  keys: Readonly<Record<string, unknown>>,
  fn: () => Promise<void> | void,
): Promise<void> => {
  const prior = new Map<string, unknown>()
  const priorSnapshot = mock.state.getContextKeys()
  for (const k of Object.keys(keys)) {
    if (Object.hasOwn(priorSnapshot, k)) {
      prior.set(k, priorSnapshot[k])
    }
  }
  for (const [k, v] of Object.entries(keys)) {
    mock.state.setContextKey(k, v)
  }
  try {
    await fn()
  } finally {
    for (const k of Object.keys(keys)) {
      if (prior.has(k)) {
        mock.state.setContextKey(k, prior.get(k))
      }
    }
  }
}
