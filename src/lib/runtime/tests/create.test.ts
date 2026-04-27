import { beforeEach, describe, expect, test } from 'bun:test'
import { installVSCodeMock } from '../../runtime-test/install-mock.ts'
import { createTestExtensionContext } from '../../runtime-test/create-context.ts'
import '../../runtime-test/matchers.ts'
import { createRuntime } from '../create.ts'

const vscode = installVSCodeMock()

beforeEach(() => {
  vscode.reset()
})

type CommandRegistry = {
  'vsv.greet': { args: { name: string }; result: string }
  'vsv.add': { args: { a: number; b: number }; result: number }
}

type ContextKeyRegistry = {
  'vsv.isActive': boolean
  'vsv.mode': 'on' | 'off'
}

type ConfigRegistry = {
  enabled: boolean
}

type StateRegistry = {
  lastRun: { value: number; scope: 'global' }
}

type EventRegistry = {
  pulse: number
}

describe('createRuntime', () => {
  describe('defineCommand / executeCommand', () => {
    test('registers a typed command', () => {
      const r = createRuntime<CommandRegistry>()
      r.defineCommand('vsv.greet', async (args) => `Hello ${args.name}`)
      expect(vscode).toHaveRegisteredCommand('vsv.greet')
    })

    test('handler receives typed args and returns typed result', async () => {
      const r = createRuntime<CommandRegistry>()
      r.defineCommand('vsv.add', ({ a, b }) => a + b)
      const result = await r.executeCommand('vsv.add', { a: 2, b: 3 })
      expect(result).toBe(5)
    })
  })

  describe('defineContextKey', () => {
    test('sets initial value via setContext command', () => {
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistry>()
      r.defineContextKey('vsv.isActive', false)
      expect(vscode).toHaveContextKey('vsv.isActive', false)
    })

    test('set() updates value and fires onChange listeners', async () => {
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistry>()
      const handle = r.defineContextKey('vsv.isActive', false)
      const observed: boolean[] = []
      handle.onChange((v) => observed.push(v))
      await handle.set(true)
      expect(handle.get()).toBe(true)
      expect(observed).toEqual([true])
      expect(vscode).toHaveContextKey('vsv.isActive', true)
    })

    test('onChange disposal removes listener', async () => {
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistry>()
      const handle = r.defineContextKey('vsv.mode', 'off')
      let count = 0
      const d = handle.onChange(() => {
        count += 1
      })
      await handle.set('on')
      d.dispose()
      await handle.set('off')
      expect(count).toBe(1)
    })
  })

  describe('defineConfig', () => {
    test('reads value from workspace configuration', () => {
      vscode.state.setConfiguration({ enabled: true })
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistryShape, ConfigRegistry>()
      const handle = r.defineConfig('enabled')
      expect(handle.get()).toBe(true)
    })

    test('update writes value into configuration', async () => {
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistryShape, ConfigRegistry>()
      const handle = r.defineConfig('enabled')
      await handle.update(true)
      expect(handle.get()).toBe(true)
    })

    test('getWithDefault returns defaultValue when key is missing', () => {
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistryShape, ConfigRegistry>()
      const handle = r.defineConfig('enabled')
      expect(handle.getWithDefault(false)).toBe(false)
    })
  })

  describe('defineState', () => {
    test('reads, writes, deletes from globalState', async () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistry
      >()
      const ctx = createTestExtensionContext()
      const handle = r.defineState(ctx, 'lastRun', 'global')
      expect(handle.get()).toBeUndefined()
      await handle.set(1234)
      expect(handle.get()).toBe(1234)
      await handle.delete()
      expect(handle.get()).toBeUndefined()
    })

    test('getWithDefault returns defaultValue when key is missing', () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistry
      >()
      const ctx = createTestExtensionContext()
      const handle = r.defineState(ctx, 'lastRun', 'global')
      expect(handle.getWithDefault(0)).toBe(0)
    })

    test('getWithDefault returns stored value when key is set', async () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistry
      >()
      const ctx = createTestExtensionContext()
      const handle = r.defineState(ctx, 'lastRun', 'global')
      await handle.set(7)
      expect(handle.getWithDefault(0)).toBe(7)
    })
  })

  describe('defineEvent', () => {
    test('fire() notifies subscribers', () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistry
      >()
      const ev = r.defineEvent('pulse')
      const received: number[] = []
      const d = ev.event((v) => received.push(v))
      ev.fire(1)
      ev.fire(2)
      d.dispose()
      ev.fire(3)
      expect(received).toEqual([1, 2])
    })
  })

  describe('quickPick', () => {
    test('returns value of the matched label', async () => {
      const r = createRuntime()
      vscode.state.setNextQuickPickResult({ label: 'One' })
      const picked = await r.quickPick([
        { label: 'One', value: 1 },
        { label: 'Two', value: 2 },
      ])
      expect(picked).toBe(1)
    })

    test('returns undefined when nothing is picked', async () => {
      const r = createRuntime()
      vscode.state.setNextQuickPickResult(undefined)
      const picked = await r.quickPick([{ label: 'x', value: 1 }])
      expect(picked).toBeUndefined()
    })
  })

  describe('disposables', () => {
    test('dispose() disposes all members', () => {
      const r = createRuntime()
      const flags = { a: false, b: false }
      const group = r.disposables(
        { dispose: () => (flags.a = true) },
        { dispose: () => (flags.b = true) },
      )
      group.dispose()
      expect(flags.a).toBe(true)
      expect(flags.b).toBe(true)
    })
  })
})

type CommandRegistryShape = Record<string, { args: unknown; result: unknown }>
type ContextKeyRegistryShape = Record<string, unknown>
type ConfigRegistryShape = Record<string, unknown>
type StateRegistryShape = Record<string, { value: unknown; scope: 'global' | 'workspace' }>
