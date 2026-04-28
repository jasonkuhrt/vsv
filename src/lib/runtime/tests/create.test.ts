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

type ForeignConfigRegistry = {
  'editor.codeLens': boolean
  'explorer.confirmDelete': boolean
  'problems.visibility': boolean
}

type ExternalCommandRegistry = {
  // No args (Schema.Void → void). Caller invokes as
  // `rt.executeExternalCommand('moveFileToTrash')` — no extra args.
  moveFileToTrash: { args: void; result: void }
  // Tuple args (Schema.Tuple → [...]) spread positionally:
  // `rt.executeExternalCommand('list.expand', uri)`. The single-Uri tuple is
  // the simplest case of positional args.
  'list.expand': { args: [string]; result: void }
  // Three positional args, returning a typed result:
  // `rt.executeExternalCommand('vscode.executeDocumentRenameProvider', uri, pos, name)`.
  'vscode.executeDocumentRenameProvider': {
    args: [string, { line: number; character: number }, string]
    result: { applied: boolean }
  }
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

  describe('executeExternalCommand', () => {
    test('nullary (void args) invokes vscode command with id only', async () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistry
      >()
      // Pre-register a fake handler so we can observe the call shape.
      const vs = await import('vscode')
      let calledWith: unknown[] = ['NOT-CALLED']
      vs.commands.registerCommand('moveFileToTrash', (...a: unknown[]) => {
        calledWith = a
        return undefined
      })
      await r.executeExternalCommand('moveFileToTrash')
      // VSCode's executeCommand passes the registered handler (...args)
      // directly. With void/nullary, no positional args land on the handler.
      expect(calledWith).toEqual([])
    })

    test('tuple args spread into positional vscode.commands.executeCommand args', async () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistry
      >()
      const vs = await import('vscode')
      let observed: unknown[] = ['NOT-CALLED']
      vs.commands.registerCommand('list.expand', (...a: unknown[]) => {
        observed = a
      })
      await r.executeExternalCommand('list.expand', 'file:///x.ts')
      expect(observed).toEqual(['file:///x.ts'])
    })

    test('multi-arg tuple flows through positionally', async () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistry
      >()
      const vs = await import('vscode')
      let observed: unknown[] = []
      vs.commands.registerCommand('vscode.executeDocumentRenameProvider', (...a: unknown[]) => {
        observed = a
        return { applied: true }
      })
      const result = await r.executeExternalCommand(
        'vscode.executeDocumentRenameProvider',
        'file:///x.ts',
        { line: 0, character: 5 },
        'newName',
      )
      expect(observed).toEqual(['file:///x.ts', { line: 0, character: 5 }, 'newName'])
      expect(result.applied).toBe(true)
    })

    test('records the invocation in executedCommands', async () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistry
      >()
      await r.executeExternalCommand('moveFileToTrash')
      expect(vscode).toHaveExecutedCommand('moveFileToTrash')
    })
  })

  describe('defineForeignConfig', () => {
    test('reads the merged value of a foreign setting', () => {
      vscode.state.setConfigurationDetail('editor.codeLens', { globalValue: true })
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistryShape,
        ForeignConfigRegistry
      >()
      const handle = r.defineForeignConfig('editor.codeLens')
      expect(handle.get()).toBe(true)
    })

    test('update writes to the chosen target without re-contributing the key', async () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistryShape,
        ForeignConfigRegistry
      >()
      const handle = r.defineForeignConfig('editor.codeLens')
      await handle.update(true, 1 /* Global */ as never)
      expect(handle.inspect()?.globalValue).toBe(true)
      // The package.json sync isn't running here, but the manifest never
      // contained `editor.codeLens` in `config: [...]` — only in
      // `foreignConfig: [...]`. Codegen tests below verify the
      // contributes.configuration sync is skipped for foreign keys.
    })

    test('inspect returns per-target snapshot for snapshot/restore patterns', async () => {
      vscode.state.setConfigurationDetail('explorer.confirmDelete', { globalValue: true })
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistryShape,
        ForeignConfigRegistry
      >()
      const handle = r.defineForeignConfig('explorer.confirmDelete')
      const original = handle.inspect()?.globalValue
      expect(original).toBe(true)
      await handle.update(false, 1 /* Global */ as never)
      expect(handle.inspect()?.globalValue).toBe(false)
      // Restore original; cast since `original` is `boolean | undefined` after
      // the optional-chain on inspect, but the snapshot/restore pattern
      // assumes the original value's defined.
      await handle.update(original ?? true, 1 /* Global */ as never)
      expect(handle.inspect()?.globalValue).toBe(true)
    })

    test('getWithDefault falls back when unset', () => {
      const r = createRuntime<
        CommandRegistryShape,
        ContextKeyRegistryShape,
        ConfigRegistryShape,
        StateRegistryShape,
        EventRegistryShape,
        ExternalCommandRegistryShape,
        ForeignConfigRegistry
      >()
      const handle = r.defineForeignConfig('problems.visibility')
      expect(handle.getWithDefault(false)).toBe(false)
    })
  })

  describe('defineConfig.inspect', () => {
    test('returns undefined for unset keys', () => {
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistryShape, ConfigRegistry>()
      const handle = r.defineConfig('enabled')
      expect(handle.inspect()).toBeUndefined()
    })

    test('reflects per-target writes from update', async () => {
      const r = createRuntime<CommandRegistryShape, ContextKeyRegistryShape, ConfigRegistry>()
      const handle = r.defineConfig('enabled')
      await handle.update(true, 1 /* Global */ as never)
      const ins = handle.inspect()
      expect(ins?.globalValue).toBe(true)
      expect(ins?.workspaceValue).toBeUndefined()
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

  describe('notify', () => {
    test('info records a message at the info level', async () => {
      const r = createRuntime()
      await r.notify.info('hello')
      const msgs = vscode.state.getShownMessages()
      expect(msgs).toEqual([{ level: 'info', message: 'hello' }])
    })

    test('warn records at the warn level', async () => {
      const r = createRuntime()
      await r.notify.warn('careful')
      expect(vscode.state.getShownMessages()).toEqual([{ level: 'warn', message: 'careful' }])
    })

    test('error records at the error level', async () => {
      const r = createRuntime()
      await r.notify.error('boom')
      expect(vscode.state.getShownMessages()).toEqual([{ level: 'error', message: 'boom' }])
    })

    test('prompt forwards options and returns the seeded input', async () => {
      const r = createRuntime()
      vscode.state.setNextInputBoxResult('typed-value')
      const result = await r.notify.prompt({
        prompt: 'enter something',
        value: 'pre-filled',
        valueSelection: [0, 11],
      })
      expect(result).toBe('typed-value')
      const recorded = vscode.state.getShownInputBoxes()
      expect(recorded).toHaveLength(1)
      const opts = recorded[0]?.options as {
        prompt: string
        value: string
        valueSelection: [number, number]
      }
      expect(opts.prompt).toBe('enter something')
      expect(opts.value).toBe('pre-filled')
      expect(opts.valueSelection).toEqual([0, 11])
    })

    test('prompt returns undefined when dismissed', async () => {
      const r = createRuntime()
      vscode.state.setNextInputBoxResult(undefined)
      const result = await r.notify.prompt({ prompt: 'enter' })
      expect(result).toBeUndefined()
    })
  })

  describe('statusBar', () => {
    test('message records a status bar message with the default timeout', () => {
      const r = createRuntime()
      r.statusBar.message('hello')
      const msgs = vscode.state.getStatusBarMessages()
      expect(msgs).toEqual([{ message: 'hello', hideAfterTimeout: 1500 }])
    })

    test('message respects an explicit timeout', () => {
      const r = createRuntime()
      r.statusBar.message('hello', 5000)
      expect(vscode.state.getStatusBarMessages()).toEqual([
        { message: 'hello', hideAfterTimeout: 5000 },
      ])
    })
  })

  describe('clipboard', () => {
    test('writeText then readText round-trips the value', async () => {
      const r = createRuntime()
      await r.clipboard.writeText('hello')
      expect(await r.clipboard.readText()).toBe('hello')
    })

    test('readText returns the seeded clipboard value', async () => {
      const r = createRuntime()
      vscode.state.setClipboard('seeded')
      expect(await r.clipboard.readText()).toBe('seeded')
    })

    test('writeText updates observable mock state', async () => {
      const r = createRuntime()
      await r.clipboard.writeText('written')
      expect(vscode.state.getClipboard()).toBe('written')
    })
  })

  describe('workspace.folders', () => {
    test('returns undefined when no folder is open', () => {
      const r = createRuntime()
      expect(r.workspace.folders).toBeUndefined()
    })

    test('returns the seeded folders with computed indexes', () => {
      const r = createRuntime()
      const fakeUri = {
        fsPath: '/repo/a',
        toString: () => 'file:///repo/a',
      } as unknown as import('vscode').Uri
      vscode.state.setWorkspaceFolders([{ uri: fakeUri }])
      const folders = r.workspace.folders
      expect(folders).toHaveLength(1)
      expect(folders?.[0]?.index).toBe(0)
      expect(folders?.[0]?.name).toBe('a')
    })
  })

  describe('fs', () => {
    test('readDirectory returns seeded entries', async () => {
      const r = createRuntime()
      const dirUri = { fsPath: '/repo' } as unknown as import('vscode').Uri
      vscode.state.setFsDirectory('/repo', [
        ['src', 2 /* Directory */],
        ['readme.md', 1 /* File */],
      ])
      const entries = await r.fs.readDirectory(dirUri)
      expect(entries).toHaveLength(2)
      expect(entries[0]?.[0]).toBe('src')
      expect(entries[1]?.[0]).toBe('readme.md')
    })

    test('readDirectory throws on missing path', async () => {
      const r = createRuntime()
      const dirUri = { fsPath: '/nonexistent' } as unknown as import('vscode').Uri
      let caught: Error | undefined
      try {
        await r.fs.readDirectory(dirUri)
      } catch (e) {
        caught = e as Error
      }
      expect(caught?.message).toMatch(/ENOENT/)
    })

    test('stat returns the seeded stat', async () => {
      const r = createRuntime()
      const fileUri = { fsPath: '/repo/a' } as unknown as import('vscode').Uri
      vscode.state.setFsStat('/repo/a', { type: 1, ctime: 0, mtime: 0, size: 42 })
      const stat = await r.fs.stat(fileUri)
      expect(stat.size).toBe(42)
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
type EventRegistryShape = Record<string, unknown>
type ExternalCommandRegistryShape = Record<string, { args: unknown; result: unknown }>
