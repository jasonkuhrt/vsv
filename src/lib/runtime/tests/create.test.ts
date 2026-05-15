import { beforeEach, describe, expect, test } from 'bun:test'
import { Data, Effect, Exit, Schema } from 'effect'
import * as nodeFs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { CommandDecl } from '../../manifest/decls/command.ts'
import { ConfigDecl } from '../../manifest/decls/config.ts'
import { ContextKeyDecl } from '../../manifest/decls/context-key.ts'
import { ExternalCommandDecl } from '../../manifest/decls/external-command.ts'
import { ForeignConfigDecl } from '../../manifest/decls/foreign-config.ts'
import { StateDecl } from '../../manifest/decls/state.ts'
import { defineManifest } from '../../manifest/define.ts'
import { createTestExtensionContext } from '../../runtime-test/create-context.ts'
import { installVSCodeMock } from '../../runtime-test/install-mock.ts'
import '../../runtime-test/matchers.ts'
import { createRuntime } from '../create.ts'
import {
  ClipboardError,
  CommandExecutionError,
  ConfigUpdateError,
  DocumentOpenError,
  DocumentSaveError,
  FileNotFoundError,
  StateUpdateError,
  UnsupportedSchemeError,
} from '../errors.ts'
import { ConfigurationTarget } from '../values.ts'

const vscode = installVSCodeMock()

beforeEach(() => {
  vscode.reset()
})

// Shared test manifest covering every runtime surface the suite exercises.
// One source of typing — `createRuntime(testManifest)` reads every method's
// arg/result/value type from this manifest's tuple shape via the mapped types
// in `../registries.ts`.
const testManifest = defineManifest({
  name: 'vsv-test',
  publisher: 'vsv',
  commands: [
    CommandDecl({
      id: 'vsv.greet',
      args: Schema.Struct({ name: Schema.String }),
      result: Schema.String,
    }),
    CommandDecl({
      id: 'vsv.add',
      args: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
      result: Schema.Number,
    }),
    CommandDecl({ id: 'vsv.fail', args: Schema.Void, result: Schema.Void }),
  ],
  contextKeys: [
    ContextKeyDecl({ name: 'vsv.isActive', valueType: Schema.Boolean }),
    ContextKeyDecl({ name: 'vsv.mode', valueType: Schema.Literal('on', 'off') }),
  ],
  config: [ConfigDecl({ key: 'enabled', valueSchema: Schema.Boolean })],
  state: [StateDecl({ key: 'lastRun', scope: 'global', valueSchema: Schema.Number })],
  foreignConfig: [
    ForeignConfigDecl({ fullKey: 'editor.codeLens', valueSchema: Schema.Boolean }),
    ForeignConfigDecl({ fullKey: 'explorer.confirmDelete', valueSchema: Schema.Boolean }),
    ForeignConfigDecl({ fullKey: 'problems.visibility', valueSchema: Schema.Boolean }),
  ],
  externalCommands: [
    // No args (Schema.Void → void). Caller invokes as
    // `rt.executeExternalCommand('moveFileToTrash')` — no extra args.
    ExternalCommandDecl({ id: 'moveFileToTrash', args: Schema.Void, result: Schema.Void }),
    // Tuple args (Schema.Tuple → readonly [string]) spread positionally:
    // `rt.executeExternalCommand('list.expand', uri)`. Single-element tuple
    // is the simplest case of positional args.
    ExternalCommandDecl({
      id: 'list.expand',
      args: Schema.Tuple(Schema.String),
      result: Schema.Void,
    }),
    // Three positional args, returning a typed result.
    ExternalCommandDecl({
      id: 'vscode.executeDocumentRenameProvider',
      args: Schema.Tuple(
        Schema.String,
        Schema.Struct({ line: Schema.Number, character: Schema.Number }),
        Schema.String,
      ),
      result: Schema.Struct({ applied: Schema.Boolean }),
    }),
  ],
})

describe('createRuntime', () => {
  describe('defineCommand / executeCommand', () => {
    test('registers a typed command with an Effect handler', () => {
      const r = createRuntime(testManifest)
      Effect.runSync(r.defineCommand('vsv.greet', (args) => Effect.succeed(`Hello ${args.name}`)))
      expect(vscode).toHaveRegisteredCommand('vsv.greet')
    })

    test('handler receives typed args and returns typed result', async () => {
      const r = createRuntime(testManifest)
      Effect.runSync(r.defineCommand('vsv.add', ({ a, b }) => Effect.succeed(a + b)))
      const result = await Effect.runPromise(r.executeCommand('vsv.add', { a: 2, b: 3 }))
      expect(result).toBe(5)
    })

    test('Effect handler can yield other effects mid-flow', async () => {
      const r = createRuntime(testManifest)
      Effect.runSync(
        r.defineCommand('vsv.add', ({ a, b }) =>
          Effect.gen(function* () {
            // Sanity: ensure handlers can use full Effect.gen.
            const sum = yield* Effect.succeed(a + b)
            return sum
          }),
        ),
      )
      const result = await Effect.runPromise(r.executeCommand('vsv.add', { a: 7, b: 8 }))
      expect(result).toBe(15)
    })

    test('handler failure surfaces as CommandExecutionError on executeCommand', async () => {
      const r = createRuntime(testManifest)
      Effect.runSync(r.defineCommand('vsv.fail', () => Effect.fail(new Error('boom'))))
      const exit = await Effect.runPromiseExit(r.executeCommand('vsv.fail', undefined))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(CommandExecutionError)
        expect((err as CommandExecutionError).id).toBe('vsv.fail')
      }
    })

    test('handler tagged-error identity is preserved through the bridge', async () => {
      // The bridge thunk in defineCommand uses runPromiseExit + Cause.failureOption
      // to project the failure into a plain throwable that preserves the original
      // Data.TaggedError instance. This pins that contract: a consumer matching
      // on `CommandExecutionError.cause._tag` should see the handler's original
      // tag, not Effect's `FiberFailure` wrapper.
      class HandlerSpecificError extends Data.TaggedError('HandlerSpecificError')<{
        readonly detail: string
      }> {}
      const r = createRuntime(testManifest)
      Effect.runSync(
        r.defineCommand('vsv.fail', () =>
          Effect.fail(new HandlerSpecificError({ detail: 'precise' })),
        ),
      )
      const exit = await Effect.runPromiseExit(r.executeCommand('vsv.fail', undefined))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit) && exit.cause._tag === 'Fail') {
        const outer = exit.cause.error
        expect(outer).toBeInstanceOf(CommandExecutionError)
        const inner = outer.cause
        expect(inner).toBeInstanceOf(HandlerSpecificError)
        // _tag identity survives the round-trip; consumers can `Match.tag` on it.
        expect((inner as HandlerSpecificError)._tag).toBe('HandlerSpecificError')
        expect((inner as HandlerSpecificError).detail).toBe('precise')
      }
    })
  })

  describe('executeExternalCommand', () => {
    test('nullary (void args) invokes vscode command with id only', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      let calledWith: unknown[] = ['NOT-CALLED']
      vs.commands.registerCommand('moveFileToTrash', (...a: unknown[]) => {
        calledWith = a
        return undefined
      })
      await Effect.runPromise(r.executeExternalCommand('moveFileToTrash'))
      expect(calledWith).toEqual([])
    })

    test('tuple args spread into positional vscode.commands.executeCommand args', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      let observed: unknown[] = ['NOT-CALLED']
      vs.commands.registerCommand('list.expand', (...a: unknown[]) => {
        observed = a
      })
      await Effect.runPromise(r.executeExternalCommand('list.expand', 'file:///x.ts'))
      expect(observed).toEqual(['file:///x.ts'])
    })

    test('multi-arg tuple flows through positionally', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      let observed: unknown[] = []
      vs.commands.registerCommand('vscode.executeDocumentRenameProvider', (...a: unknown[]) => {
        observed = a
        return { applied: true }
      })
      const result = await Effect.runPromise(
        r.executeExternalCommand(
          'vscode.executeDocumentRenameProvider',
          'file:///x.ts',
          { line: 0, character: 5 },
          'newName',
        ),
      )
      expect(observed).toEqual(['file:///x.ts', { line: 0, character: 5 }, 'newName'])
      expect(result.applied).toBe(true)
    })

    test('records the invocation in executedCommands', async () => {
      const r = createRuntime(testManifest)
      await Effect.runPromise(r.executeExternalCommand('moveFileToTrash'))
      expect(vscode).toHaveExecutedCommand('moveFileToTrash')
    })

    test('command rejection surfaces as CommandExecutionError', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      vs.commands.registerCommand('list.expand', () => {
        throw new Error('rejected')
      })
      const exit = await Effect.runPromiseExit(
        r.executeExternalCommand('list.expand', 'file:///x.ts'),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(CommandExecutionError)
        expect((err as CommandExecutionError).id).toBe('list.expand')
      }
    })
  })

  describe('executeCommandRaw', () => {
    test('forwards id + args through to vscode.commands.executeCommand', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      let observed: unknown[] = []
      vs.commands.registerCommand('any.id', (...a: unknown[]) => {
        observed = a
        return 42
      })
      const result = await Effect.runPromise(r.executeCommandRaw('any.id', 'a', 1))
      expect(observed).toEqual(['a', 1])
      expect(result).toBe(42)
    })

    test('rejection surfaces as CommandExecutionError', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      vs.commands.registerCommand('any.id', () => {
        throw new Error('nope')
      })
      const exit = await Effect.runPromiseExit(r.executeCommandRaw('any.id'))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(CommandExecutionError)
      }
    })
  })

  describe('defineForeignConfig', () => {
    test('reads the merged value of a foreign setting', () => {
      vscode.state.setConfigurationDetail('editor.codeLens', { globalValue: true })
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineForeignConfig('editor.codeLens'))
      expect(Effect.runSync(handle.get())).toBe(true)
    })

    test('update writes to the chosen target without re-contributing the key', async () => {
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineForeignConfig('editor.codeLens'))
      await Effect.runPromise(handle.update(true, ConfigurationTarget.Global))
      expect(Effect.runSync(handle.inspect())?.globalValue).toBe(true)
    })

    test('inspect returns per-target snapshot for snapshot/restore patterns', async () => {
      vscode.state.setConfigurationDetail('explorer.confirmDelete', { globalValue: true })
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineForeignConfig('explorer.confirmDelete'))
      const original = Effect.runSync(handle.inspect())?.globalValue
      expect(original).toBe(true)
      await Effect.runPromise(handle.update(false, ConfigurationTarget.Global))
      expect(Effect.runSync(handle.inspect())?.globalValue).toBe(false)
      await Effect.runPromise(handle.update(original ?? true, ConfigurationTarget.Global))
      expect(Effect.runSync(handle.inspect())?.globalValue).toBe(true)
    })

    test('getWithDefault falls back when unset', () => {
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineForeignConfig('problems.visibility'))
      expect(Effect.runSync(handle.getWithDefault(false))).toBe(false)
    })
  })

  describe('defineConfig.inspect', () => {
    test('returns undefined for unset keys', () => {
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineConfig('enabled'))
      expect(Effect.runSync(handle.inspect())).toBeUndefined()
    })

    test('reflects per-target writes from update', async () => {
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineConfig('enabled'))
      await Effect.runPromise(handle.update(true, ConfigurationTarget.Global))
      const ins = Effect.runSync(handle.inspect())
      expect(ins?.globalValue).toBe(true)
      expect(ins?.workspaceValue).toBeUndefined()
    })

    test('update failure surfaces as ConfigUpdateError', async () => {
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineConfig('enabled'))
      // Spy: replace the mock's update to throw, exercising the catch path.
      const vs = (await import('vscode')) as unknown as {
        workspace: {
          getConfiguration: typeof import('../../runtime-test/vscode-mock.ts').workspace.getConfiguration
        }
      }
      const original = vs.workspace.getConfiguration
      vs.workspace.getConfiguration = (section?: string) => {
        const cfg = original(section)
        return {
          ...cfg,
          update: () => Promise.reject(new Error('write rejected')),
        }
      }
      try {
        const exit = await Effect.runPromiseExit(handle.update(true, ConfigurationTarget.Global))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
          expect(err).toBeInstanceOf(ConfigUpdateError)
          expect((err as ConfigUpdateError).key).toBe('enabled')
        }
      } finally {
        vs.workspace.getConfiguration = original
      }
    })
  })

  describe('defineContextKey', () => {
    test('sets initial value via setContext command', async () => {
      const r = createRuntime(testManifest)
      await Effect.runPromise(r.defineContextKey('vsv.isActive', false))
      expect(vscode).toHaveContextKey('vsv.isActive', false)
    })

    test('set() updates value and fires onChange listeners', async () => {
      const r = createRuntime(testManifest)
      const handle = await Effect.runPromise(r.defineContextKey('vsv.isActive', false))
      const observed: boolean[] = []
      Effect.runSync(handle.onChange((v) => observed.push(v)))
      await Effect.runPromise(handle.set(true))
      expect(Effect.runSync(handle.get())).toBe(true)
      expect(observed).toEqual([true])
      expect(vscode).toHaveContextKey('vsv.isActive', true)
    })

    test('onChange disposal removes listener', async () => {
      const r = createRuntime(testManifest)
      const handle = await Effect.runPromise(r.defineContextKey('vsv.mode', 'off'))
      let count = 0
      const d = Effect.runSync(
        handle.onChange(() => {
          count += 1
        }),
      )
      await Effect.runPromise(handle.set('on'))
      d.dispose()
      await Effect.runPromise(handle.set('off'))
      expect(count).toBe(1)
    })

    test('a throwing listener does not abort sibling listeners or the Effect', async () => {
      // The listener loop runs each callback in isolation: failures are
      // swallowed (and logged) rather than rejecting the never-typed Effect or
      // skipping siblings. This is critical because `set` has a `never` error
      // channel — a throwing listener would otherwise become a defect that
      // crashes the calling fiber.
      const r = createRuntime(testManifest)
      const handle = await Effect.runPromise(r.defineContextKey('vsv.isActive', false))
      // Silence console.error for this test — the impl logs each listener
      // throw, which would otherwise spam test output.
      const originalError = console.error
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      console.error = () => {}
      try {
        let firstCalled = false
        let thirdCalled = false
        Effect.runSync(
          handle.onChange(() => {
            firstCalled = true
          }),
        )
        Effect.runSync(
          handle.onChange(() => {
            throw new Error('listener crash — should be isolated')
          }),
        )
        Effect.runSync(
          handle.onChange(() => {
            thirdCalled = true
          }),
        )
        // Effect must succeed even though one listener threw.
        await Effect.runPromise(handle.set(true))
        expect(firstCalled).toBe(true)
        expect(thirdCalled).toBe(true)
        // State mutation still landed.
        expect(Effect.runSync(handle.get())).toBe(true)
      } finally {
        console.error = originalError
      }
    })
  })

  describe('defineConfig', () => {
    test('reads value from workspace configuration', () => {
      vscode.state.setConfiguration({ enabled: true })
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineConfig('enabled'))
      expect(Effect.runSync(handle.get())).toBe(true)
    })

    test('update writes value into configuration', async () => {
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineConfig('enabled'))
      await Effect.runPromise(handle.update(true))
      expect(Effect.runSync(handle.get())).toBe(true)
    })

    test('getWithDefault returns defaultValue when key is missing', () => {
      const r = createRuntime(testManifest)
      const handle = Effect.runSync(r.defineConfig('enabled'))
      expect(Effect.runSync(handle.getWithDefault(false))).toBe(false)
    })
  })

  describe('defineState', () => {
    test('reads, writes, deletes from globalState', async () => {
      const r = createRuntime(testManifest)
      const ctx = createTestExtensionContext()
      const handle = Effect.runSync(r.defineState(ctx, 'lastRun', 'global'))
      expect(Effect.runSync(handle.get())).toBeUndefined()
      await Effect.runPromise(handle.set(1234))
      expect(Effect.runSync(handle.get())).toBe(1234)
      await Effect.runPromise(handle.delete())
      expect(Effect.runSync(handle.get())).toBeUndefined()
    })

    test('getWithDefault returns defaultValue when key is missing', () => {
      const r = createRuntime(testManifest)
      const ctx = createTestExtensionContext()
      const handle = Effect.runSync(r.defineState(ctx, 'lastRun', 'global'))
      expect(Effect.runSync(handle.getWithDefault(0))).toBe(0)
    })

    test('getWithDefault returns stored value when key is set', async () => {
      const r = createRuntime(testManifest)
      const ctx = createTestExtensionContext()
      const handle = Effect.runSync(r.defineState(ctx, 'lastRun', 'global'))
      await Effect.runPromise(handle.set(7))
      expect(Effect.runSync(handle.getWithDefault(0))).toBe(7)
    })

    test('set rejection surfaces as StateUpdateError', async () => {
      const r = createRuntime(testManifest)
      // Hand-built broken context — `update` rejects to exercise the error path.
      const ctx = createTestExtensionContext()
      const original = ctx.globalState.update.bind(ctx.globalState)
      ctx.globalState.update = () => Promise.reject(new Error('memento offline'))
      try {
        const handle = Effect.runSync(r.defineState(ctx, 'lastRun', 'global'))
        const exit = await Effect.runPromiseExit(handle.set(1))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
          expect(err).toBeInstanceOf(StateUpdateError)
          expect((err as StateUpdateError).key).toBe('lastRun')
          expect((err as StateUpdateError).operation).toBe('set')
        }
      } finally {
        ctx.globalState.update = original
      }
    })
  })

  describe('defineEvent', () => {
    test('fire() notifies subscribers', () => {
      const r = createRuntime(testManifest)
      const ev = Effect.runSync(r.defineEvent('pulse'))
      // Events aren't manifest-driven yet — payload is `unknown` until an
      // `EventDecl` lands. Pub/sub mechanics are still covered.
      const received: unknown[] = []
      const d = Effect.runSync(ev.event((v) => received.push(v)))
      Effect.runSync(ev.fire(1))
      Effect.runSync(ev.fire(2))
      d.dispose()
      Effect.runSync(ev.fire(3))
      expect(received).toEqual([1, 2])
    })
  })

  describe('quickPick', () => {
    test('returns value of the matched label', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setNextQuickPickResult({ label: 'One' })
      const picked = await Effect.runPromise(
        r.quickPick([
          { label: 'One', value: 1 },
          { label: 'Two', value: 2 },
        ]),
      )
      expect(picked).toBe(1)
    })

    test('returns undefined when nothing is picked', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setNextQuickPickResult(undefined)
      const picked = await Effect.runPromise(r.quickPick([{ label: 'x', value: 1 }]))
      expect(picked).toBeUndefined()
    })
  })

  describe('notify', () => {
    test('info records a message at the info level', async () => {
      const r = createRuntime(testManifest)
      await Effect.runPromise(r.notify.info('hello'))
      const msgs = vscode.state.getShownMessages()
      expect(msgs).toEqual([{ level: 'info', message: 'hello', actions: [] }])
    })

    test('warn records at the warn level', async () => {
      const r = createRuntime(testManifest)
      await Effect.runPromise(r.notify.warn('careful'))
      expect(vscode.state.getShownMessages()).toEqual([
        { level: 'warn', message: 'careful', actions: [] },
      ])
    })

    test('error records at the error level', async () => {
      const r = createRuntime(testManifest)
      await Effect.runPromise(r.notify.error('boom'))
      expect(vscode.state.getShownMessages()).toEqual([
        { level: 'error', message: 'boom', actions: [] },
      ])
    })

    test('action buttons forward through and return the user-clicked label', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setNextMessageResult('Retry')
      const picked = await Effect.runPromise(r.notify.error('failed', 'Retry', 'Cancel'))
      expect(picked).toBe('Retry')
      expect(vscode.state.getShownMessages()).toEqual([
        { level: 'error', message: 'failed', actions: ['Retry', 'Cancel'] },
      ])
    })

    test('no-action notifications always yield undefined regardless of seeded result', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setNextMessageResult('IGNORED')
      const picked = await Effect.runPromise(r.notify.info('plain'))
      expect(picked).toBeUndefined()
    })

    test('prompt forwards options and returns the seeded input', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setNextInputBoxResult('typed-value')
      const result = await Effect.runPromise(
        r.notify.prompt({
          prompt: 'enter something',
          value: 'pre-filled',
          valueSelection: [0, 11],
        }),
      )
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
      const r = createRuntime(testManifest)
      vscode.state.setNextInputBoxResult(undefined)
      const result = await Effect.runPromise(r.notify.prompt({ prompt: 'enter' }))
      expect(result).toBeUndefined()
    })
  })

  describe('statusBar', () => {
    test('message records a status bar message with the default timeout', () => {
      const r = createRuntime(testManifest)
      Effect.runSync(r.statusBar.message('hello'))
      const msgs = vscode.state.getStatusBarMessages()
      expect(msgs).toEqual([{ message: 'hello', hideAfterTimeout: 1500 }])
    })

    test('message respects an explicit timeout', () => {
      const r = createRuntime(testManifest)
      Effect.runSync(r.statusBar.message('hello', 5000))
      expect(vscode.state.getStatusBarMessages()).toEqual([
        { message: 'hello', hideAfterTimeout: 5000 },
      ])
    })
  })

  describe('clipboard', () => {
    test('writeText then readText round-trips the value', async () => {
      const r = createRuntime(testManifest)
      await Effect.runPromise(r.clipboard.writeText('hello'))
      expect(await Effect.runPromise(r.clipboard.readText())).toBe('hello')
    })

    test('readText returns the seeded clipboard value', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setClipboard('seeded')
      expect(await Effect.runPromise(r.clipboard.readText())).toBe('seeded')
    })

    test('writeText updates observable mock state', async () => {
      const r = createRuntime(testManifest)
      await Effect.runPromise(r.clipboard.writeText('written'))
      expect(vscode.state.getClipboard()).toBe('written')
    })

    test('readText rejection surfaces as ClipboardError', async () => {
      const r = createRuntime(testManifest)
      const vs = (await import('vscode')) as unknown as {
        env: {
          clipboard: { readText: () => Promise<string>; writeText: (t: string) => Promise<void> }
        }
      }
      const original = vs.env.clipboard.readText
      vs.env.clipboard.readText = () => Promise.reject(new Error('IPC down'))
      try {
        const exit = await Effect.runPromiseExit(r.clipboard.readText())
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
          expect(err).toBeInstanceOf(ClipboardError)
          expect((err as ClipboardError).operation).toBe('readText')
        }
      } finally {
        vs.env.clipboard.readText = original
      }
    })
  })

  describe('workspace.folders', () => {
    test('returns undefined when no folder is open', () => {
      const r = createRuntime(testManifest)
      expect(Effect.runSync(r.workspace.folders())).toBeUndefined()
    })

    test('returns the seeded folders with computed indexes', () => {
      const r = createRuntime(testManifest)
      const fakeUri = {
        fsPath: '/repo/a',
        toString: () => 'file:///repo/a',
      } as unknown as import('vscode').Uri
      vscode.state.setWorkspaceFolders([{ uri: fakeUri }])
      const folders = Effect.runSync(r.workspace.folders())
      expect(folders).toHaveLength(1)
      expect(folders?.[0]?.index).toBe(0)
      expect(folders?.[0]?.name).toBe('a')
    })
  })

  describe('workspace.openTextDocument', () => {
    test('opens a seeded document', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const uri = vs.Uri.parse('file:///foo.ts')
      vscode.state.openDocument(uri, 'console.log("hi")')
      const doc = await Effect.runPromise(r.workspace.openTextDocument(uri))
      expect(doc.getText()).toBe('console.log("hi")')
    })

    test('opens by string path', async () => {
      const r = createRuntime(testManifest)
      vscode.state.openDocument('/x/y.ts', 'export const x = 1')
      const doc = await Effect.runPromise(r.workspace.openTextDocument('/x/y.ts'))
      expect(doc.getText()).toBe('export const x = 1')
    })

    test('rejection surfaces as DocumentOpenError', async () => {
      const r = createRuntime(testManifest)
      const vs = (await import('vscode')) as unknown as {
        workspace: { openTextDocument: (t: unknown) => Promise<unknown> }
      }
      const original = vs.workspace.openTextDocument
      vs.workspace.openTextDocument = () => Promise.reject(new Error('no provider'))
      try {
        const exit = await Effect.runPromiseExit(r.workspace.openTextDocument('untitled:nope.ts'))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
          expect(err).toBeInstanceOf(DocumentOpenError)
        }
      } finally {
        vs.workspace.openTextDocument = original
      }
    })
  })

  describe('workspace.onDidChangeTextDocument', () => {
    test('subscribes to text document change events', () => {
      const r = createRuntime(testManifest)
      const doc = vscode.state.openDocument('file:///changed.ts', 'before')
      const seen: string[] = []
      const disposable = Effect.runSync(
        r.workspace.onDidChangeTextDocument((event) => {
          seen.push(event.contentChanges.map((change) => change.text).join(''))
        }),
      )

      vscode.state.fireTextDocumentChange(doc, [{ text: '/done' }])
      disposable.dispose()
      vscode.state.fireTextDocumentChange(doc, [{ text: 'ignored' }])

      expect(seen).toEqual(['/done'])
    })
  })

  describe('workspace.saveTextDocument', () => {
    test('saves a document and yields true', async () => {
      const r = createRuntime(testManifest)
      const doc = vscode.state.openDocument('file:///save-me.ts', 'content')

      const result = await Effect.runPromise(
        r.workspace.saveTextDocument(doc as unknown as import('vscode').TextDocument),
      )
      expect(result).toBe(true)
    })

    test('rejection surfaces as DocumentSaveError', async () => {
      const r = createRuntime(testManifest)
      const doc = vscode.state.openDocument(
        'file:///save-fails.ts',
        'content',
      ) as unknown as import('vscode').TextDocument & { save: () => Promise<boolean> }
      const original = doc.save
      doc.save = () => Promise.reject(new Error('readonly'))
      try {
        const exit = await Effect.runPromiseExit(r.workspace.saveTextDocument(doc))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
          expect(err).toBeInstanceOf(DocumentSaveError)
        }
      } finally {
        doc.save = original
      }
    })
  })

  describe('workspace.applyEdit', () => {
    test('applies an edit and yields true', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const uri = vs.Uri.parse('file:///foo.ts')
      vscode.state.openDocument(uri, 'before')
      const edit = new vs.WorkspaceEdit()
      edit.replace(uri, new vs.Range(0, 0, 0, 6), 'after')
      const result = await Effect.runPromise(r.workspace.applyEdit(edit))
      expect(result).toBe(true)
    })
  })

  describe('workspace.updateFolders', () => {
    test('forwards args to vscode.workspace.updateWorkspaceFolders and returns true', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const uri = vs.Uri.file('/repo/added')
      const ok = Effect.runSync(r.workspace.updateFolders(0, 0, { uri, name: 'added' }))
      expect(ok).toBe(true)
      const calls = vscode.state.getUpdateFolderCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]?.start).toBe(0)
      expect(calls[0]?.deleteCount).toBe(0)
      expect(calls[0]?.adds[0]?.name).toBe('added')
    })

    test('returns false when vscode rejects the splice (e.g. invalid args)', () => {
      const r = createRuntime(testManifest)
      vscode.state.setNextUpdateFoldersResult(false)
      const ok = Effect.runSync(r.workspace.updateFolders(99, 99)) // out-of-range delete
      expect(ok).toBe(false)
    })
  })

  describe('window.showOpenDialog', () => {
    test('forwards options and yields the seeded selection', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const selected = vs.Uri.file('/picked.ts')
      vscode.state.setNextOpenDialogResult([selected])
      const result = await Effect.runPromise(
        r.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: false,
          filters: { TypeScript: ['ts'] },
          title: 'Pick',
        }),
      )
      expect(result).toEqual([selected])
      const calls = vscode.state.getOpenDialogCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]?.options.canSelectFiles).toBe(true)
      expect(calls[0]?.options.title).toBe('Pick')
      expect(calls[0]?.options.filters).toEqual({ TypeScript: ['ts'] })
    })

    test('yields undefined when the user dismisses the dialog', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setNextOpenDialogResult(undefined)
      const result = await Effect.runPromise(r.window.showOpenDialog())
      expect(result).toBeUndefined()
    })
  })

  describe('fs', () => {
    test('readDirectory returns seeded entries', async () => {
      const r = createRuntime(testManifest)
      const dirUri = { fsPath: '/repo' } as unknown as import('vscode').Uri
      vscode.state.setFsDirectory('/repo', [
        ['src', 2 /* Directory */],
        ['readme.md', 1 /* File */],
      ])
      const entries = await Effect.runPromise(r.fs.readDirectory(dirUri))
      expect(entries).toHaveLength(2)
      expect(entries[0]?.[0]).toBe('src')
      expect(entries[1]?.[0]).toBe('readme.md')
    })

    test('readDirectory on missing path fails with FileNotFoundError', async () => {
      const r = createRuntime(testManifest)
      const dirUri = { fsPath: '/nonexistent' } as unknown as import('vscode').Uri
      const exit = await Effect.runPromiseExit(r.fs.readDirectory(dirUri))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(FileNotFoundError)
        expect((err as FileNotFoundError).operation).toBe('readDirectory')
      }
    })

    test('stat returns the seeded stat', async () => {
      const r = createRuntime(testManifest)
      const fileUri = { fsPath: '/repo/a' } as unknown as import('vscode').Uri
      vscode.state.setFsStat('/repo/a', { type: 1, ctime: 0, mtime: 0, size: 42 })
      const stat = await Effect.runPromise(r.fs.stat(fileUri))
      expect(stat.size).toBe(42)
    })

    test('stat on missing path fails with FileNotFoundError', async () => {
      const r = createRuntime(testManifest)
      const fileUri = { fsPath: '/missing' } as unknown as import('vscode').Uri
      const exit = await Effect.runPromiseExit(r.fs.stat(fileUri))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(FileNotFoundError)
        expect((err as FileNotFoundError).operation).toBe('stat')
      }
    })

    test('readFile returns seeded contents', async () => {
      const r = createRuntime(testManifest)
      const fileUri = { fsPath: '/repo/menus.json' } as unknown as import('vscode').Uri
      const content = new TextEncoder().encode('{"version":1}')
      vscode.state.setFsContent('/repo/menus.json', content)
      const bytes = await Effect.runPromise(r.fs.readFile(fileUri))
      expect(new TextDecoder().decode(bytes)).toBe('{"version":1}')
    })

    test('readFile on missing path fails with FileNotFoundError', async () => {
      const r = createRuntime(testManifest)
      const fileUri = { fsPath: '/nope' } as unknown as import('vscode').Uri
      const exit = await Effect.runPromiseExit(r.fs.readFile(fileUri))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(FileNotFoundError)
        expect((err as FileNotFoundError).operation).toBe('readFile')
      }
    })

    test('writeFile records contents readable via readFile', async () => {
      const r = createRuntime(testManifest)
      const fileUri = { fsPath: '/repo/out.txt' } as unknown as import('vscode').Uri
      const content = new TextEncoder().encode('hello')
      await Effect.runPromise(r.fs.writeFile(fileUri, content))
      const round = await Effect.runPromise(r.fs.readFile(fileUri))
      expect(new TextDecoder().decode(round)).toBe('hello')
    })

    test('createDirectory is idempotent', async () => {
      const r = createRuntime(testManifest)
      const dirUri = { fsPath: '/repo/new' } as unknown as import('vscode').Uri
      await Effect.runPromise(r.fs.createDirectory(dirUri))
      // Second call must not throw — VSCode's createDirectory is recursive
      // and idempotent by contract.
      await Effect.runPromise(r.fs.createDirectory(dirUri))
      const stat = await Effect.runPromise(r.fs.stat(dirUri))
      expect(stat.type).toBe(2 /* Directory */)
    })

    test('rename moves file content', async () => {
      const r = createRuntime(testManifest)
      const from = { fsPath: '/repo/comments.json.tmp' } as unknown as import('vscode').Uri
      const to = { fsPath: '/repo/comments.json' } as unknown as import('vscode').Uri
      const content = new TextEncoder().encode('{"schema":1}')
      vscode.state.setFsContent(from.fsPath, content)

      await Effect.runPromise(r.fs.rename(from, to, { overwrite: true }))

      expect(vscode.state.getFsContent(from.fsPath)).toBeUndefined()
      expect(vscode.state.getFsContent(to.fsPath)).toEqual(content)
    })

    test('rename on missing path fails with FileNotFoundError', async () => {
      const r = createRuntime(testManifest)
      const from = { fsPath: '/repo/missing.tmp' } as unknown as import('vscode').Uri
      const to = { fsPath: '/repo/comments.json' } as unknown as import('vscode').Uri
      const exit = await Effect.runPromiseExit(r.fs.rename(from, to))

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(FileNotFoundError)
        expect((err as FileNotFoundError).operation).toBe('rename')
      }
    })
  })

  describe('fs.realpath', () => {
    test('resolves symlinks using Node fs', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const tmp = await nodeFs.promises.mkdtemp(path.join(os.tmpdir(), 'vsv-realpath-'))
      try {
        const target = path.join(tmp, 'real.txt')
        const link = path.join(tmp, 'link.txt')
        await nodeFs.promises.writeFile(target, 'hi', 'utf8')
        await nodeFs.promises.symlink(target, link)
        const resolved = await Effect.runPromise(r.fs.realpath(vs.Uri.file(link)))
        // realpath returns the canonical path, which on macOS may have /private prefix.
        const expected = await nodeFs.promises.realpath(target)
        expect(resolved.fsPath).toBe(expected)
      } finally {
        await nodeFs.promises.rm(tmp, { recursive: true, force: true })
      }
    })

    test('non-file scheme fails with UnsupportedSchemeError', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const remoteUri = vs.Uri.parse('vscode-remote://remote/foo')
      const exit = await Effect.runPromiseExit(r.fs.realpath(remoteUri))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(UnsupportedSchemeError)
        expect((err as UnsupportedSchemeError).operation).toBe('realpath')
        expect((err as UnsupportedSchemeError).expectedScheme).toBe('file')
      }
    })

    test('broken symlink fails with FileNotFoundError', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const tmp = await nodeFs.promises.mkdtemp(path.join(os.tmpdir(), 'vsv-realpath-'))
      try {
        const link = path.join(tmp, 'broken.txt')
        await nodeFs.promises.symlink(path.join(tmp, 'does-not-exist.txt'), link)
        const exit = await Effect.runPromiseExit(r.fs.realpath(vs.Uri.file(link)))
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
          expect(err).toBeInstanceOf(FileNotFoundError)
          expect((err as FileNotFoundError).operation).toBe('realpath')
        }
      } finally {
        await nodeFs.promises.rm(tmp, { recursive: true, force: true })
      }
    })

    test('non-existent path fails with FileNotFoundError', async () => {
      const r = createRuntime(testManifest)
      const vs = await import('vscode')
      const exit = await Effect.runPromiseExit(
        r.fs.realpath(vs.Uri.file('/does/not/exist/anywhere/ever')),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause._tag === 'Fail' ? exit.cause.error : undefined
        expect(err).toBeInstanceOf(FileNotFoundError)
      }
    })
  })

  describe('tabs.close', () => {
    test('closes all targeted tabs and yields true', async () => {
      const r = createRuntime(testManifest)
      vscode.state.setTabs([
        { label: 'a.ts', isPinned: false },
        { label: 'b.ts', isPinned: false },
      ])
      const groups = Effect.runSync(r.tabs.groups())
      const firstTab = groups[0]?.tabs[0]
      // The mock stores `MockTab` objects which match the structural shape vscode
      // exposes well enough for our wrapper. The cast is at the test boundary.
      const ok = await Effect.runPromise(r.tabs.close(firstTab as unknown as import('vscode').Tab))
      expect(ok).toBe(true)
      const closed = vscode.state.getClosedTabs()
      expect(closed).toHaveLength(1)
      expect(closed[0]?.label).toBe('a.ts')
    })
  })

  describe('disposables', () => {
    test('dispose() disposes all members', () => {
      const r = createRuntime(testManifest)
      const flags = { a: false, b: false }
      const group = Effect.runSync(
        r.disposables({ dispose: () => (flags.a = true) }, { dispose: () => (flags.b = true) }),
      )
      group.dispose()
      expect(flags.a).toBe(true)
      expect(flags.b).toBe(true)
    })
  })
})
