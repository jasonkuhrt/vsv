import { beforeEach, describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import type { Scope } from 'effect';
import {
  Array,
  Cause,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Option,
  Path,
  Schema,
} from 'effect';
import { CommandDecl } from '../../manifest/decls/command.ts';
import { ConfigDecl } from '../../manifest/decls/config.ts';
import { ContextKeyDecl } from '../../manifest/decls/context-key.ts';
import { ExternalCommandDecl } from '../../manifest/decls/external-command.ts';
import { ForeignConfigDecl } from '../../manifest/decls/foreign-config.ts';
import { StateDecl } from '../../manifest/decls/state.ts';
import { defineManifest } from '../../manifest/define.ts';
import { createTestExtensionContext } from '../../runtime-test/create-context.ts';
import { installVSCodeMock } from '../../runtime-test/install-mock.ts';
import { testEffect } from '../../runtime-test/test-effect.ts';
import * as vs from '../../runtime-test/vscode-mock.ts';
import { createRuntime } from '../create.ts';
import {
  ClipboardError,
  CommandExecutionError,
  ConfigUpdateError,
  DocumentOpenError,
  DocumentSaveError,
  FileNotFoundError,
  StateUpdateError,
  UnsupportedSchemeError,
} from '../errors.ts';
import { VSCodeHost, VSCodeHostError } from '../vscode-host.ts';
import type { VSCodeHostApi } from '../vscode-host.ts';

const vscode = installVSCodeMock();
const { ConfigurationTarget } = vs;

class TestFailure extends Schema.TaggedError<TestFailure, {}>()('TestFailure', {
  message: Schema.String,
}) {}

const rejectHostCall = () =>
  Effect.runPromise(
    Effect.fail(TestFailure.make({ message: 'fixture failure' })),
  );
const rejectHostEffect = () =>
  Effect.failSync(() =>
    VSCodeHostError.make({
      operation: 'test',
      cause: TestFailure.make({ message: 'fixture failure' }),
    }),
  );

const failListener = () =>
  Effect.runSync(Effect.die(TestFailure.make({ message: 'listener failure' })));

beforeEach(() => {
  vscode.reset();
});

// Shared test manifest covering every runtime surface the suite exercises.
// One source of typing — `createRuntime(testManifest)` reads every method's
// arg/result/value type from this manifest's tuple shape via the mapped types
// in `../registries.ts`.
const testRuntime = <E>(
  name: string,
  program: Effect.Effect<void, E, BunServices.BunServices | Scope.Scope>,
) => {
  testEffect(
    name,
    program.pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
};

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
      args: Schema.Struct({ a: Schema.Finite, b: Schema.Finite }),
      result: Schema.Finite,
    }),
    CommandDecl({ id: 'vsv.fail', args: Schema.Void, result: Schema.Void }),
  ],
  contextKeys: [
    ContextKeyDecl({ name: 'vsv.isActive', valueType: Schema.Boolean }),
    ContextKeyDecl({
      name: 'vsv.mode',
      valueType: Schema.Literals(['on', 'off']),
    }),
  ],
  config: [ConfigDecl({ key: 'enabled', valueSchema: Schema.Boolean })],
  state: [
    StateDecl({ key: 'lastRun', scope: 'global', valueSchema: Schema.Finite }),
  ],
  foreignConfig: [
    ForeignConfigDecl({
      fullKey: 'editor.codeLens',
      valueSchema: Schema.Boolean,
    }),
    ForeignConfigDecl({
      fullKey: 'explorer.confirmDelete',
      valueSchema: Schema.Boolean,
    }),
    ForeignConfigDecl({
      fullKey: 'problems.visibility',
      valueSchema: Schema.Boolean,
    }),
  ],
  externalCommands: [
    // No args (Schema.Void → void). Caller invokes as
    // `rt.executeExternalCommand('moveFileToTrash')` — no extra args.
    ExternalCommandDecl({
      id: 'moveFileToTrash',
      args: Schema.Void,
      result: Schema.Void,
    }),
    // Tuple args (Schema.Tuple → readonly [string]) spread positionally:
    // `rt.executeExternalCommand('list.expand', uri)`. Single-element tuple
    // is the simplest case of positional args.
    ExternalCommandDecl({
      id: 'list.expand',
      args: Schema.Tuple([Schema.String]),
      result: Schema.Void,
    }),
    // Three positional args, returning a typed result.
    ExternalCommandDecl({
      id: 'vscode.executeDocumentRenameProvider',
      args: Schema.Tuple([
        Schema.String,
        Schema.Struct({ line: Schema.Finite, character: Schema.Finite }),
        Schema.String,
      ]),
      result: Schema.Struct({ applied: Schema.Boolean }),
    }),
  ],
});

const runtime = (layer = vscode.layer) =>
  Effect.runSync(Effect.provide(createRuntime(testManifest), layer));
const runtimeWith = (replace: (host: VSCodeHostApi) => VSCodeHostApi) =>
  runtime(
    Layer.effect(VSCodeHost, Effect.map(VSCodeHost, replace)).pipe(
      Layer.provide(vscode.layer),
    ),
  );

describe('createRuntime', () => {
  describe('defineCommand / executeCommand', () => {
    test('registers a typed command with an Effect handler', () => {
      const r = runtime();
      Effect.runSync(
        r.defineCommand('vsv.greet', (args) =>
          Effect.succeed(`Hello ${args.name}`),
        ),
      );
      expect(vscode).toHaveRegisteredCommand('vsv.greet');
    });

    testRuntime(
      'handler receives typed args and returns typed result',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.defineCommand('vsv.add', ({ a, b }) => Effect.succeed(a + b));
        const result = yield* r.executeCommand('vsv.add', { a: 2, b: 3 });
        expect(result).toBe(5);
      }),
    );

    testRuntime(
      'Effect handler can yield other effects mid-flow',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.defineCommand('vsv.add', ({ a, b }) =>
          Effect.gen(function* () {
            // Sanity: ensure handlers can use full Effect.gen.
            const sum = yield* Effect.succeed(a + b);
            return sum;
          }),
        );
        const result = yield* r.executeCommand('vsv.add', { a: 7, b: 8 });
        expect(result).toBe(15);
      }),
    );

    testRuntime(
      'handler failure surfaces as CommandExecutionError on executeCommand',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.defineCommand('vsv.fail', () =>
          Effect.failSync(() => TestFailure.make({ message: 'boom' })),
        );
        const exit = yield* Effect.exit(
          r.executeCommand('vsv.fail', undefined),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(CommandExecutionError);
          expect(err?.id).toBe('vsv.fail');
        }
      }),
    );

    testRuntime(
      'handler tagged-error identity is preserved through the bridge',
      Effect.gen(function* () {
        // The bridge thunk in defineCommand uses runPromiseExit + Cause.failureOption
        // to project the failure into a plain throwable that preserves the original
        // Data.TaggedError instance. This pins that contract: a consumer matching
        // on `CommandExecutionError.cause._tag` should see the handler's original
        // tag, not Effect's `FiberFailure` wrapper.
        class HandlerSpecificError extends Schema.TaggedError<
          HandlerSpecificError,
          {}
        >()('HandlerSpecificError', { detail: Schema.String }) {}
        const r = runtime();
        yield* r.defineCommand('vsv.fail', () =>
          Effect.fail(HandlerSpecificError.make({ detail: 'precise' })),
        );
        const exit = yield* Effect.exit(
          r.executeCommand('vsv.fail', undefined),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const outer = Option.getOrUndefined(
            Cause.findErrorOption(exit.cause),
          );
          expect(outer).toBeInstanceOf(CommandExecutionError);
          const inner = outer?.cause;
          expect(inner).toBeInstanceOf(HandlerSpecificError);
          // _tag identity survives the round-trip; consumers can `Match.tag` on it.
          expect(
            Schema.is(HandlerSpecificError)(inner) ? inner._tag : undefined,
          ).toBe('HandlerSpecificError');
          expect(
            Schema.is(HandlerSpecificError)(inner) ? inner.detail : undefined,
          ).toBe('precise');
        }
      }),
    );
  });

  describe('executeExternalCommand', () => {
    testRuntime(
      'nullary (void args) invokes vscode command with id only',
      Effect.gen(function* () {
        const r = runtime();
        let calledWith: unknown[] = ['NOT-CALLED'];
        vs.commands.registerCommand('moveFileToTrash', (...a: unknown[]) => {
          calledWith = a;
          return undefined;
        });
        yield* r.executeExternalCommand('moveFileToTrash');
        expect(calledWith).toEqual([]);
      }),
    );

    testRuntime(
      'tuple args spread into positional vscode.commands.executeCommand args',
      Effect.gen(function* () {
        const r = runtime();
        let observed: unknown[] = ['NOT-CALLED'];
        vs.commands.registerCommand('list.expand', (...a: unknown[]) => {
          observed = a;
        });
        yield* r.executeExternalCommand('list.expand', 'file:///x.ts');
        expect(observed).toEqual(['file:///x.ts']);
      }),
    );

    testRuntime(
      'multi-arg tuple flows through positionally',
      Effect.gen(function* () {
        const r = runtime();
        let observed: unknown[] = [];
        vs.commands.registerCommand(
          'vscode.executeDocumentRenameProvider',
          (...a: unknown[]) => {
            observed = a;
            return { applied: true };
          },
        );
        const result = yield* r.executeExternalCommand(
          'vscode.executeDocumentRenameProvider',
          'file:///x.ts',
          { line: 0, character: 5 },
          'newName',
        );
        expect(observed).toEqual([
          'file:///x.ts',
          { line: 0, character: 5 },
          'newName',
        ]);
        expect(result.applied).toBe(true);
      }),
    );

    testRuntime(
      'records the invocation in executedCommands',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.executeExternalCommand('moveFileToTrash');
        expect(vscode).toHaveExecutedCommand('moveFileToTrash');
      }),
    );

    testRuntime(
      'command rejection surfaces as CommandExecutionError',
      Effect.gen(function* () {
        const r = runtime();
        vs.commands.registerCommand('list.expand', rejectHostCall);
        const exit = yield* Effect.exit(
          r.executeExternalCommand('list.expand', 'file:///x.ts'),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(CommandExecutionError);
          expect(err?.id).toBe('list.expand');
        }
      }),
    );
  });

  describe('executeCommandRaw', () => {
    testRuntime(
      'forwards id + args through to vscode.commands.executeCommand',
      Effect.gen(function* () {
        const r = runtime();
        let observed: unknown[] = [];
        vs.commands.registerCommand('any.id', (...a: unknown[]) => {
          observed = a;
          return 42;
        });
        const result = yield* r.executeCommandRaw('any.id', 'a', 1);
        expect(observed).toEqual(['a', 1]);
        expect(result).toBe(42);
      }),
    );

    testRuntime(
      'rejection surfaces as CommandExecutionError',
      Effect.gen(function* () {
        const r = runtime();
        vs.commands.registerCommand('any.id', rejectHostCall);
        const exit = yield* Effect.exit(r.executeCommandRaw('any.id'));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(CommandExecutionError);
        }
      }),
    );
  });

  describe('defineForeignConfig', () => {
    test('reads the merged value of a foreign setting', () => {
      vscode.state.setConfigurationDetail('editor.codeLens', {
        globalValue: true,
      });
      const r = runtime();
      const handle = Effect.runSync(r.defineForeignConfig('editor.codeLens'));
      expect(Effect.runSync(handle.get)).toBe(true);
    });

    testRuntime(
      'update writes to the chosen target without re-contributing the key',
      Effect.gen(function* () {
        const r = runtime();
        const handle = yield* r.defineForeignConfig('editor.codeLens');
        yield* handle.update(true, ConfigurationTarget.Global);
        expect((yield* handle.inspect)?.globalValue).toBe(true);
      }),
    );

    testRuntime(
      'inspect returns per-target snapshot for snapshot/restore patterns',
      Effect.gen(function* () {
        vscode.state.setConfigurationDetail('explorer.confirmDelete', {
          globalValue: true,
        });
        const r = runtime();
        const handle = yield* r.defineForeignConfig('explorer.confirmDelete');
        const original = (yield* handle.inspect)?.globalValue;
        expect(original).toBe(true);
        yield* handle.update(false, ConfigurationTarget.Global);
        expect((yield* handle.inspect)?.globalValue).toBe(false);
        yield* handle.update(original ?? true, ConfigurationTarget.Global);
        expect((yield* handle.inspect)?.globalValue).toBe(true);
      }),
    );

    test('getWithDefault falls back when unset', () => {
      const r = runtime();
      const handle = Effect.runSync(
        r.defineForeignConfig('problems.visibility'),
      );
      expect(Effect.runSync(handle.getWithDefault(false))).toBe(false);
    });
  });

  describe('defineConfig.inspect', () => {
    test('returns undefined for unset keys', () => {
      const r = runtime();
      const handle = Effect.runSync(r.defineConfig('enabled'));
      expect(Effect.runSync(handle.inspect)).toBeUndefined();
    });

    testRuntime(
      'reflects per-target writes from update',
      Effect.gen(function* () {
        const r = runtime();
        const handle = yield* r.defineConfig('enabled');
        yield* handle.update(true, ConfigurationTarget.Global);
        const ins = yield* handle.inspect;
        expect(ins?.globalValue).toBe(true);
        expect(ins?.workspaceValue).toBeUndefined();
      }),
    );

    testRuntime(
      'update failure surfaces as ConfigUpdateError',
      Effect.gen(function* () {
        const r = runtimeWith((host) => ({
          ...host,
          workspace: {
            ...host.workspace,
            getConfiguration: (section) => ({
              ...host.workspace.getConfiguration(section),
              update: rejectHostEffect,
            }),
          },
        }));
        const handle = yield* r.defineConfig('enabled');
        const error = yield* Effect.flip(
          handle.update(true, ConfigurationTarget.Global),
        );
        expect(error).toBeInstanceOf(ConfigUpdateError);
        expect(error.key).toBe('enabled');
      }),
    );
  });

  describe('defineContextKey', () => {
    testRuntime(
      'sets initial value via setContext command',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.defineContextKey('vsv.isActive', false);
        expect(vscode).toHaveContextKey('vsv.isActive', false);
      }),
    );

    testRuntime(
      'set() updates value and fires onChange listeners',
      Effect.gen(function* () {
        const r = runtime();
        const handle = yield* r.defineContextKey('vsv.isActive', false);
        const observed: boolean[] = [];
        yield* handle.onChange((v) => {
          observed.push(v);
        });
        yield* handle.set(true);
        const received = yield* handle.get;
        expect(received).toBe(true);
        expect(observed).toEqual([true]);
        expect(vscode).toHaveContextKey('vsv.isActive', true);
      }),
    );

    testRuntime(
      'onChange disposal removes listener',
      Effect.gen(function* () {
        const r = runtime();
        const handle = yield* r.defineContextKey('vsv.mode', 'off');
        let count = 0;
        const d = yield* handle.onChange(() => {
          count += 1;
        });
        yield* handle.set('on');
        d.dispose();
        yield* handle.set('off');
        expect(count).toBe(1);
      }),
    );

    testRuntime(
      'a throwing listener does not abort sibling listeners or the Effect',
      Effect.gen(function* () {
        const r = runtime();
        const handle = yield* r.defineContextKey('vsv.isActive', false);
        const seen: Array<boolean> = [];
        yield* handle.onChange((value) => {
          seen.push(value);
        });
        yield* handle.onChange(failListener);
        yield* handle.onChange((value) => {
          seen.push(value);
        });
        yield* handle.set(true).pipe(Effect.provide(Logger.layer([])));
        expect(seen).toEqual([true, true]);
        const received2 = yield* handle.get;
        expect(received2).toBe(true);
      }),
    );
  });

  describe('defineConfig', () => {
    test('reads value from workspace configuration', () => {
      vscode.state.setConfiguration({ enabled: true });
      const r = runtime();
      const handle = Effect.runSync(r.defineConfig('enabled'));
      expect(Effect.runSync(handle.get)).toBe(true);
    });

    testRuntime(
      'update writes value into configuration',
      Effect.gen(function* () {
        const r = runtime();
        const handle = yield* r.defineConfig('enabled');
        yield* handle.update(true);
        const received3 = yield* handle.get;
        expect(received3).toBe(true);
      }),
    );

    test('getWithDefault returns defaultValue when key is missing', () => {
      const r = runtime();
      const handle = Effect.runSync(r.defineConfig('enabled'));
      expect(Effect.runSync(handle.getWithDefault(false))).toBe(false);
    });
  });

  describe('defineState', () => {
    testRuntime(
      'reads, writes, deletes from globalState',
      Effect.gen(function* () {
        const r = runtime();
        const ctx = createTestExtensionContext();
        const handle = yield* r.defineState(ctx, 'lastRun', 'global');
        const received4 = yield* handle.get;
        expect(received4).toBeUndefined();
        yield* handle.set(1234);
        const received5 = yield* handle.get;
        expect(received5).toBe(1234);
        yield* handle.delete;
        const received6 = yield* handle.get;
        expect(received6).toBeUndefined();
      }),
    );

    test('getWithDefault returns defaultValue when key is missing', () => {
      const r = runtime();
      const ctx = createTestExtensionContext();
      const handle = Effect.runSync(r.defineState(ctx, 'lastRun', 'global'));
      expect(Effect.runSync(handle.getWithDefault(0))).toBe(0);
    });

    testRuntime(
      'getWithDefault returns stored value when key is set',
      Effect.gen(function* () {
        const r = runtime();
        const ctx = createTestExtensionContext();
        const handle = yield* r.defineState(ctx, 'lastRun', 'global');
        yield* handle.set(7);
        const received7 = yield* handle.getWithDefault(0);
        expect(received7).toBe(7);
      }),
    );

    testRuntime(
      'set rejection surfaces as StateUpdateError',
      Effect.gen(function* () {
        const context = createTestExtensionContext();
        const ctx = {
          ...context,
          globalState: { ...context.globalState, update: rejectHostCall },
        };
        const handle = yield* runtime().defineState(ctx, 'lastRun', 'global');
        const error = yield* Effect.flip(handle.set(1));
        expect(error).toBeInstanceOf(StateUpdateError);
        expect(error.key).toBe('lastRun');
        expect(error.operation).toBe('set');
      }),
    );
  });

  describe('defineEvent', () => {
    test('fire() notifies subscribers', () => {
      const r = runtime();
      const ev = Effect.runSync(r.defineEvent('pulse'));
      // Events aren't manifest-driven yet — payload is `unknown` until an
      // `EventDecl` lands. Pub/sub mechanics are still covered.
      const received: unknown[] = [];
      const d = Effect.runSync(
        ev.event((v) => {
          received.push(v);
        }),
      );
      Effect.runSync(ev.fire(1));
      Effect.runSync(ev.fire(2));
      d.dispose();
      Effect.runSync(ev.fire(3));
      expect(received).toEqual([1, 2]);
    });
  });

  describe('quickPick', () => {
    testRuntime(
      'returns value of the matched label',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setNextQuickPickResult({ label: 'One' });
        const picked = yield* r.quickPick([
          { label: 'One', value: 1 },
          { label: 'Two', value: 2 },
        ]);
        expect(picked).toBe(1);
      }),
    );

    testRuntime(
      'returns undefined when nothing is picked',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setNextQuickPickResult(undefined);
        const picked = yield* r.quickPick([{ label: 'x', value: 1 }]);
        expect(picked).toBeUndefined();
      }),
    );
  });

  describe('notify', () => {
    testRuntime(
      'info records a message at the info level',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.notify.info('hello');
        const msgs = vscode.state.getShownMessages();
        expect(msgs).toEqual([
          { level: 'info', message: 'hello', actions: [] },
        ]);
      }),
    );

    testRuntime(
      'warn records at the warn level',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.notify.warn('careful');
        expect(vscode.state.getShownMessages()).toEqual([
          { level: 'warn', message: 'careful', actions: [] },
        ]);
      }),
    );

    testRuntime(
      'error records at the error level',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.notify.error('boom');
        expect(vscode.state.getShownMessages()).toEqual([
          { level: 'error', message: 'boom', actions: [] },
        ]);
      }),
    );

    testRuntime(
      'action buttons forward through and return the user-clicked label',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setNextMessageResult('Retry');
        const picked = yield* r.notify.error('failed', 'Retry', 'Cancel');
        expect(picked).toBe('Retry');
        expect(vscode.state.getShownMessages()).toEqual([
          { level: 'error', message: 'failed', actions: ['Retry', 'Cancel'] },
        ]);
      }),
    );

    testRuntime(
      'no-action notifications always yield undefined regardless of seeded result',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setNextMessageResult('IGNORED');
        const picked = yield* r.notify.info('plain');
        expect(picked).toBeUndefined();
      }),
    );

    testRuntime(
      'prompt forwards options and returns the seeded input',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setNextInputBoxResult('typed-value');
        const result = yield* r.notify.prompt({
          prompt: 'enter something',
          value: 'pre-filled',
          valueSelection: [0, 11],
        });
        expect(result).toBe('typed-value');
        const recorded = vscode.state.getShownInputBoxes();
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.options).toMatchObject({
          prompt: 'enter something',
          value: 'pre-filled',
          valueSelection: [0, 11],
        });
      }),
    );

    testRuntime(
      'prompt returns undefined when dismissed',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setNextInputBoxResult(undefined);
        const result = yield* r.notify.prompt({ prompt: 'enter' });
        expect(result).toBeUndefined();
      }),
    );
  });

  describe('statusBar', () => {
    test('message records a status bar message with the default timeout', () => {
      const r = runtime();
      Effect.runSync(r.statusBar.message('hello'));
      const msgs = vscode.state.getStatusBarMessages();
      expect(msgs).toEqual([{ message: 'hello', hideAfterTimeout: 1500 }]);
    });

    test('message respects an explicit timeout', () => {
      const r = runtime();
      Effect.runSync(r.statusBar.message('hello', 5000));
      expect(vscode.state.getStatusBarMessages()).toEqual([
        { message: 'hello', hideAfterTimeout: 5000 },
      ]);
    });
  });

  describe('clipboard', () => {
    testRuntime(
      'writeText then readText round-trips the value',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.clipboard.writeText('hello');
        const received8 = yield* r.clipboard.readText;
        expect(received8).toBe('hello');
      }),
    );

    testRuntime(
      'readText returns the seeded clipboard value',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setClipboard('seeded');
        const received9 = yield* r.clipboard.readText;
        expect(received9).toBe('seeded');
      }),
    );

    testRuntime(
      'writeText updates observable mock state',
      Effect.gen(function* () {
        const r = runtime();
        yield* r.clipboard.writeText('written');
        expect(vscode.state.getClipboard()).toBe('written');
      }),
    );

    testRuntime(
      'readText rejection surfaces as ClipboardError',
      Effect.gen(function* () {
        const r = runtimeWith((host) => ({
          ...host,
          env: {
            clipboard: { ...host.env.clipboard, readText: rejectHostEffect },
          },
        }));
        const error = yield* Effect.flip(r.clipboard.readText);
        expect(error).toBeInstanceOf(ClipboardError);
        expect(error.operation).toBe('readText');
      }),
    );
  });

  describe('workspace.folders', () => {
    test('returns undefined when no folder is open', () => {
      const r = runtime();
      expect(Effect.runSync(r.workspace.folders)).toBeUndefined();
    });

    test('returns the seeded folders with computed indexes', () => {
      const r = runtime();
      const fakeUri = vs.Uri.file('/repo/a');
      vscode.state.setWorkspaceFolders([{ uri: fakeUri }]);
      const folders = Effect.runSync(r.workspace.folders);
      expect(folders).toHaveLength(1);
      expect(folders?.[0]?.index).toBe(0);
      expect(folders?.[0]?.name).toBe('a');
    });
  });

  describe('workspace.openTextDocument', () => {
    testRuntime(
      'opens a seeded document',
      Effect.gen(function* () {
        const r = runtime();
        const uri = vs.Uri.parse('file:///foo.ts');
        vscode.state.openDocument(uri, 'console.log("hi")');
        const doc = yield* r.workspace.openTextDocument(uri);
        expect(doc.getText()).toBe('console.log("hi")');
      }),
    );

    testRuntime(
      'opens by string path',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.openDocument('/x/y.ts', 'export const x = 1');
        const doc = yield* r.workspace.openTextDocument('/x/y.ts');
        expect(doc.getText()).toBe('export const x = 1');
      }),
    );

    testRuntime(
      'rejection surfaces as DocumentOpenError',
      Effect.gen(function* () {
        const r = runtimeWith((host) => ({
          ...host,
          workspace: { ...host.workspace, openTextDocument: rejectHostEffect },
        }));
        const error = yield* Effect.flip(
          r.workspace.openTextDocument('untitled:nope.ts'),
        );
        expect(error).toBeInstanceOf(DocumentOpenError);
      }),
    );
  });

  describe('workspace.onDidChangeTextDocument', () => {
    test('subscribes to text document change events', () => {
      const r = runtime();
      const doc = vscode.state.openDocument('file:///changed.ts', 'before');
      const seen: string[] = [];
      const disposable = Effect.runSync(
        r.workspace.onDidChangeTextDocument((event) => {
          seen.push(
            Array.join(
              Array.map(event.contentChanges, (change) => change.text),
              '',
            ),
          );
        }),
      );

      vscode.state.fireTextDocumentChange(doc, [{ text: '/done' }]);
      disposable.dispose();
      vscode.state.fireTextDocumentChange(doc, [{ text: 'ignored' }]);

      expect(seen).toEqual(['/done']);
    });
  });

  describe('workspace.saveTextDocument', () => {
    testRuntime(
      'saves a document and yields true',
      Effect.gen(function* () {
        const r = runtime();
        const doc = vscode.state.openDocument('file:///save-me.ts', 'content');

        const result = yield* r.workspace.saveTextDocument(doc);
        expect(result).toBe(true);
      }),
    );

    testRuntime(
      'rejection surfaces as DocumentSaveError',
      Effect.gen(function* () {
        const r = runtime();
        const doc = vscode.state.openDocument('file:///locked.ts', 'immutable');
        const error = yield* Effect.flip(
          r.workspace.saveTextDocument({ ...doc, save: rejectHostCall }),
        );
        expect(error).toBeInstanceOf(DocumentSaveError);
        expect(error.uri).toBe(doc.uri);
      }),
    );
  });

  describe('workspace.applyEdit', () => {
    testRuntime(
      'applies an edit and yields true',
      Effect.gen(function* () {
        const r = runtime();
        const uri = vs.Uri.parse('file:///foo.ts');
        vscode.state.openDocument(uri, 'before');
        const edit = new vs.WorkspaceEdit();
        edit.replace(uri, new vs.Range(0, 0, 0, 6), 'after');
        const result = yield* r.workspace.applyEdit(edit);
        expect(result).toBe(true);
      }),
    );
  });

  describe('workspace.updateFolders', () => {
    test('forwards args to vscode.workspace.updateWorkspaceFolders and returns true', () => {
      const r = runtime();
      const uri = vs.Uri.file('/repo/added');
      const ok = Effect.runSync(
        r.workspace.updateFolders(0, 0, { uri, name: 'added' }),
      );
      expect(ok).toBe(true);
      const calls = vscode.state.getUpdateFolderCalls();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.start).toBe(0);
      expect(calls[0]?.deleteCount).toBe(0);
      expect(calls[0]?.adds[0]?.name).toBe('added');
    });

    test('returns false when vscode rejects the splice (e.g. invalid args)', () => {
      const r = runtime();
      vscode.state.setNextUpdateFoldersResult(false);
      const ok = Effect.runSync(r.workspace.updateFolders(99, 99)); // out-of-range delete
      expect(ok).toBe(false);
    });
  });

  describe('window.showOpenDialog', () => {
    testRuntime(
      'forwards options and yields the seeded selection',
      Effect.gen(function* () {
        const r = runtime();
        const selected = vs.Uri.file('/picked.ts');
        vscode.state.setNextOpenDialogResult([selected]);
        const result = yield* r.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: false,
          filters: { TypeScript: ['ts'] },
          title: 'Pick',
        });
        expect(result).toEqual([selected]);
        const calls = vscode.state.getOpenDialogCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0]?.options.canSelectFiles).toBe(true);
        expect(calls[0]?.options.title).toBe('Pick');
        expect(calls[0]?.options.filters).toEqual({ TypeScript: ['ts'] });
      }),
    );

    testRuntime(
      'yields undefined when the user dismisses the dialog',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setNextOpenDialogResult(undefined);
        const result = yield* r.window.showOpenDialog();
        expect(result).toBeUndefined();
      }),
    );
  });

  describe('fs', () => {
    testRuntime(
      'readDirectory returns seeded entries',
      Effect.gen(function* () {
        const r = runtime();
        const dirUri = vs.Uri.file('/repo');
        vscode.state.setFsDirectory('/repo', [
          ['src', 2 /* Directory */],
          ['readme.md', 1 /* File */],
        ]);
        const entries = yield* r.fs.readDirectory(dirUri);
        expect(entries).toHaveLength(2);
        expect(entries[0]?.[0]).toBe('src');
        expect(entries[1]?.[0]).toBe('readme.md');
      }),
    );

    testRuntime(
      'readDirectory on missing path fails with FileNotFoundError',
      Effect.gen(function* () {
        const r = runtime();
        const dirUri = vs.Uri.file('/nonexistent');
        const exit = yield* Effect.exit(r.fs.readDirectory(dirUri));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(FileNotFoundError);
          expect(err?.operation).toBe('readDirectory');
        }
      }),
    );

    testRuntime(
      'stat returns the seeded stat',
      Effect.gen(function* () {
        const r = runtime();
        const fileUri = vs.Uri.file('/repo/a');
        vscode.state.setFsStat('/repo/a', {
          type: 1,
          ctime: 0,
          mtime: 0,
          size: 42,
        });
        const stat = yield* r.fs.stat(fileUri);
        expect(stat.size).toBe(42);
      }),
    );

    testRuntime(
      'stat on missing path fails with FileNotFoundError',
      Effect.gen(function* () {
        const r = runtime();
        const fileUri = vs.Uri.file('/missing');
        const exit = yield* Effect.exit(r.fs.stat(fileUri));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(FileNotFoundError);
          expect(err?.operation).toBe('stat');
        }
      }),
    );

    testRuntime(
      'readFile returns seeded contents',
      Effect.gen(function* () {
        const r = runtime();
        const fileUri = vs.Uri.file('/repo/menus.json');
        const content = new TextEncoder().encode('{"version":1}');
        vscode.state.setFsContent('/repo/menus.json', content);
        const bytes = yield* r.fs.readFile(fileUri);
        expect(new TextDecoder().decode(bytes)).toBe('{"version":1}');
      }),
    );

    testRuntime(
      'readFile on missing path fails with FileNotFoundError',
      Effect.gen(function* () {
        const r = runtime();
        const fileUri = vs.Uri.file('/nope');
        const exit = yield* Effect.exit(r.fs.readFile(fileUri));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(FileNotFoundError);
          expect(err?.operation).toBe('readFile');
        }
      }),
    );

    testRuntime(
      'writeFile records contents readable via readFile',
      Effect.gen(function* () {
        const r = runtime();
        const fileUri = vs.Uri.file('/repo/out.txt');
        const content = new TextEncoder().encode('hello');
        yield* r.fs.writeFile(fileUri, content);
        const round = yield* r.fs.readFile(fileUri);
        expect(new TextDecoder().decode(round)).toBe('hello');
      }),
    );

    testRuntime(
      'createDirectory is idempotent',
      Effect.gen(function* () {
        const r = runtime();
        const dirUri = vs.Uri.file('/repo/new');
        yield* r.fs.createDirectory(dirUri);
        // Second call must not throw — VSCode's createDirectory is recursive
        // and idempotent by contract.
        yield* r.fs.createDirectory(dirUri);
        const stat = yield* r.fs.stat(dirUri);
        expect(stat.type).toBe(2 /* Directory */);
      }),
    );

    testRuntime(
      'rename moves file content',
      Effect.gen(function* () {
        const r = runtime();
        const from = vs.Uri.file('/repo/comments.json.tmp');
        const to = vs.Uri.file('/repo/comments.json');
        const content = new TextEncoder().encode('{"schema":1}');
        vscode.state.setFsContent(from.fsPath, content);

        yield* r.fs.rename(from, to, { overwrite: true });

        expect(vscode.state.getFsContent(from.fsPath)).toBeUndefined();
        expect(vscode.state.getFsContent(to.fsPath)).toEqual(content);
      }),
    );

    testRuntime(
      'rename on missing path fails with FileNotFoundError',
      Effect.gen(function* () {
        const r = runtime();
        const from = vs.Uri.file('/repo/missing.tmp');
        const to = vs.Uri.file('/repo/comments.json');
        const exit = yield* Effect.exit(r.fs.rename(from, to));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(FileNotFoundError);
          expect(err?.operation).toBe('rename');
        }
      }),
    );
  });

  describe('fs.realpath', () => {
    testRuntime(
      'resolves symlinks using Node fs',
      Effect.gen(function* () {
        const r = runtime();
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tmp = yield* fs.makeTempDirectoryScoped({
          prefix: 'vsv-realpath-',
        });
        const target = path.join(tmp, 'real.txt');
        const link = path.join(tmp, 'link.txt');
        yield* fs.writeFileString(target, 'hi');
        yield* fs.symlink(target, link);
        const resolved = yield* r.fs.realpath(vs.Uri.file(link));
        // realpath returns the canonical path, which on macOS may have /private prefix.
        const expected = yield* fs.realPath(target);
        expect(resolved.fsPath).toBe(expected);
      }),
    );

    testRuntime(
      'non-file scheme fails with UnsupportedSchemeError',
      Effect.gen(function* () {
        const r = runtime();
        const remoteUri = vs.Uri.parse('vscode-remote://remote/foo');
        const exit = yield* Effect.exit(r.fs.realpath(remoteUri));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(UnsupportedSchemeError);
          expect(err?.operation).toBe('realpath');
          expect(
            Schema.is(UnsupportedSchemeError)(err)
              ? err.expectedScheme
              : undefined,
          ).toBe('file');
        }
      }),
    );

    testRuntime(
      'broken symlink fails with FileNotFoundError',
      Effect.gen(function* () {
        const r = runtime();
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tmp = yield* fs.makeTempDirectoryScoped({
          prefix: 'vsv-realpath-',
        });
        const link = path.join(tmp, 'broken.txt');
        yield* fs.symlink(path.join(tmp, 'does-not-exist.txt'), link);
        const exit = yield* Effect.exit(r.fs.realpath(vs.Uri.file(link)));
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(FileNotFoundError);
          expect(err?.operation).toBe('realpath');
        }
      }),
    );

    testRuntime(
      'non-existent path fails with FileNotFoundError',
      Effect.gen(function* () {
        const r = runtime();
        const exit = yield* Effect.exit(
          r.fs.realpath(vs.Uri.file('/does/not/exist/anywhere/ever')),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const err = Option.getOrUndefined(Cause.findErrorOption(exit.cause));
          expect(err).toBeInstanceOf(FileNotFoundError);
        }
      }),
    );
  });

  describe('tabs.close', () => {
    testRuntime(
      'closes all targeted tabs and yields true',
      Effect.gen(function* () {
        const r = runtime();
        vscode.state.setTabs([
          { label: 'a.ts', isPinned: false },
          { label: 'b.ts', isPinned: false },
        ]);
        const groups = yield* r.tabs.groups;
        const firstTab = groups[0]?.tabs[0];
        expect(firstTab).toBeDefined();
        if (firstTab === undefined) return;
        const ok = yield* r.tabs.close(firstTab);
        expect(ok).toBe(true);
        const closed = vscode.state.getClosedTabs();
        expect(closed).toHaveLength(1);
        expect(closed[0]?.label).toBe('a.ts');
      }),
    );
  });

  describe('disposables', () => {
    test('dispose() disposes all members', () => {
      const r = runtime();
      const flags = { a: false, b: false };
      const group = Effect.runSync(
        r.disposables(
          {
            dispose: () => {
              flags.a = true;
            },
          },
          {
            dispose: () => {
              flags.b = true;
            },
          },
        ),
      );
      group.dispose();
      expect(flags.a).toBe(true);
      expect(flags.b).toBe(true);
    });
  });
});
