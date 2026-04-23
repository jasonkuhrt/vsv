import { beforeEach, describe, expect, test } from 'bun:test'
import { installVSCodeMock } from '../install-mock.ts'
import { createTestExtensionContext } from '../create-context.ts'
import { spyOnCommands, withContextKeys } from '../spies.ts'
import '../matchers.ts'

const vscode = installVSCodeMock()

const loadMock = async (): Promise<typeof import('../vscode-mock.ts')> =>
  (await import('vscode')) as unknown as typeof import('../vscode-mock.ts')

beforeEach(() => {
  vscode.reset()
})

describe('installVSCodeMock', () => {
  test('mock.module replaces "vscode" import', async () => {
    const mod = await loadMock()
    expect(typeof mod.commands.registerCommand).toBe('function')
    expect(typeof mod.commands.executeCommand).toBe('function')
  })

  test('registerCommand tracks ids', async () => {
    const mod = await loadMock()
    const d = mod.commands.registerCommand('foo.bar', () => {})
    expect(vscode.state.getRegisteredCommands()).toContain('foo.bar')
    d.dispose()
    expect(vscode.state.getRegisteredCommands()).not.toContain('foo.bar')
  })

  test('executeCommand invokes registered handler', async () => {
    const mod = await loadMock()
    let received: unknown
    mod.commands.registerCommand('echo', (v: unknown) => {
      received = v
      return v
    })
    const result = await mod.commands.executeCommand('echo', 42)
    expect(received).toBe(42)
    expect(result).toBe(42)
  })

  test('setContext command updates context keys state', async () => {
    const mod = await loadMock()
    await mod.commands.executeCommand('setContext', 'myKey', true)
    expect(vscode.state.getContextKeys()).toEqual({ myKey: true })
  })

  test('reset() clears all state', async () => {
    const mod = await loadMock()
    mod.commands.registerCommand('foo', () => {})
    await mod.commands.executeCommand('setContext', 'x', 1)
    expect(vscode.state.getRegisteredCommands().length).toBeGreaterThan(0)
    vscode.reset()
    expect(vscode.state.getRegisteredCommands()).toEqual([])
    expect(vscode.state.getContextKeys()).toEqual({})
  })

  test('matcher toHaveRegisteredCommand works', async () => {
    const mod = await loadMock()
    mod.commands.registerCommand('my.cmd', () => {})
    expect(vscode).toHaveRegisteredCommand('my.cmd')
    expect(vscode).not.toHaveRegisteredCommand('other.cmd')
  })

  test('matcher toHaveExecutedCommand works', async () => {
    const mod = await loadMock()
    await mod.commands.executeCommand('doThing', 'arg')
    expect(vscode).toHaveExecutedCommand('doThing')
    expect(vscode).not.toHaveExecutedCommand('nope')
  })

  test('matcher toHaveContextKey works', async () => {
    const mod = await loadMock()
    await mod.commands.executeCommand('setContext', 'isActive', true)
    expect(vscode).toHaveContextKey('isActive')
    expect(vscode).toHaveContextKey('isActive', true)
    expect(vscode).not.toHaveContextKey('isInactive')
  })
})

describe('createTestExtensionContext', () => {
  test('provides subscriptions array', () => {
    const ctx = createTestExtensionContext()
    expect(ctx.subscriptions).toEqual([])
    ctx.subscriptions.push({ dispose: () => {} })
    expect(ctx.subscriptions.length).toBe(1)
  })

  test('globalState and workspaceState are independent mementos', async () => {
    const ctx = createTestExtensionContext()
    await ctx.globalState.update('k', 'global-value')
    await ctx.workspaceState.update('k', 'workspace-value')
    expect(ctx.globalState.get<string>('k')).toBe('global-value')
    expect(ctx.workspaceState.get<string>('k')).toBe('workspace-value')
  })

  test('memento get returns defaultValue when missing', () => {
    const ctx = createTestExtensionContext()
    expect(ctx.globalState.get<string>('missing', 'fallback')).toBe('fallback')
    expect(ctx.globalState.get<string>('missing')).toBeUndefined()
  })
})

describe('spyOnCommands', () => {
  test('captures executed commands', async () => {
    const mod = await loadMock()
    const spy = spyOnCommands(vscode)
    await mod.commands.executeCommand('a', 1)
    await mod.commands.executeCommand('b', 2)
    expect(spy.getExecutions().length).toBe(2)
    expect(spy.getExecutionsFor('a').length).toBe(1)
    expect(spy.getExecutionsFor('a')[0]?.args).toEqual([1])
  })
})

describe('withContextKeys', () => {
  test('sets keys for the duration of fn and restores', async () => {
    vscode.state.setContextKey('preexisting', 'old')
    let observedInside: Readonly<Record<string, unknown>> = {}
    await withContextKeys(vscode, { preexisting: 'new', extra: 'hello' }, () => {
      observedInside = vscode.state.getContextKeys()
    })
    expect(observedInside).toEqual({ preexisting: 'new', extra: 'hello' })
    expect(vscode.state.getContextKeys()['preexisting']).toBe('old')
  })
})
