import { beforeEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { VSCodeHost } from '../../runtime/vscode-host.ts';
import { createTestExtensionContext } from '../create-context.ts';
import { installVSCodeMock } from '../install-mock.ts';
import { spyOnCommands, withContextKeys } from '../spies.ts';
import { testEffect } from '../test-effect.ts';
import * as mod from '../vscode-mock.ts';

const vscode = installVSCodeMock();

beforeEach(() => {
  vscode.reset();
});

describe('installVSCodeMock', () => {
  test('provides VS Code commands from the fixture layer', () => {
    const host = Effect.runSync(Effect.provide(VSCodeHost, vscode.layer));
    expect(host.commands).toBe(mod.commands);
    expect(typeof mod.commands.registerCommand).toBe('function');
    expect(typeof mod.commands.executeCommand).toBe('function');
  });

  test('registerCommand tracks ids', () => {
    const d = mod.commands.registerCommand('foo.bar', () => {});
    expect(vscode.state.getRegisteredCommands()).toContain('foo.bar');
    d.dispose();
    expect(vscode.state.getRegisteredCommands()).not.toContain('foo.bar');
  });

  testEffect(
    'executeCommand invokes registered handler',
    Effect.gen(function* () {
      let received: unknown;
      mod.commands.registerCommand('echo', (v: unknown) => {
        received = v;
        return v;
      });
      const result = yield* mod.commands.executeCommand('echo', 42);
      expect(received).toBe(42);
      expect(result).toBe(42);
    }),
  );

  testEffect(
    'setContext command updates context keys state',
    Effect.gen(function* () {
      yield* mod.commands.executeCommand('setContext', 'myKey', true);
      expect(vscode.state.getContextKeys()).toEqual({ myKey: true });
    }),
  );

  testEffect(
    'reset() clears all state',
    Effect.gen(function* () {
      mod.commands.registerCommand('foo', () => {});
      yield* mod.commands.executeCommand('setContext', 'x', 1);
      expect(vscode.state.getRegisteredCommands().length).toBeGreaterThan(0);
      vscode.reset();
      expect(vscode.state.getRegisteredCommands()).toEqual([]);
      expect(vscode.state.getContextKeys()).toEqual({});
    }),
  );

  test('matcher toHaveRegisteredCommand works', () => {
    mod.commands.registerCommand('my.cmd', () => {});
    expect(vscode).toHaveRegisteredCommand('my.cmd');
    expect(vscode).not.toHaveRegisteredCommand('other.cmd');
  });

  testEffect(
    'matcher toHaveExecutedCommand works',
    Effect.gen(function* () {
      yield* mod.commands.executeCommand('doThing', 'arg');
      expect(vscode).toHaveExecutedCommand('doThing');
      expect(vscode).not.toHaveExecutedCommand('nope');
    }),
  );

  testEffect(
    'matcher toHaveContextKey works',
    Effect.gen(function* () {
      yield* mod.commands.executeCommand('setContext', 'isActive', true);
      expect(vscode).toHaveContextKey('isActive');
      expect(vscode).toHaveContextKey('isActive', true);
      expect(vscode).not.toHaveContextKey('isInactive');
    }),
  );
});

describe('createTestExtensionContext', () => {
  test('provides subscriptions array', () => {
    const ctx = createTestExtensionContext();
    expect(ctx.subscriptions).toEqual([]);
    ctx.subscriptions.push({ dispose: () => {} });
    expect(ctx.subscriptions.length).toBe(1);
  });

  testEffect(
    'globalState and workspaceState are independent mementos',
    Effect.gen(function* () {
      const ctx = createTestExtensionContext();
      yield* Effect.promise(() => ctx.globalState.update('k', 'global-value'));
      yield* Effect.promise(() =>
        ctx.workspaceState.update('k', 'workspace-value'),
      );
      expect(ctx.globalState.get<string>('k')).toBe('global-value');
      expect(ctx.workspaceState.get<string>('k')).toBe('workspace-value');
    }),
  );

  test('memento get returns defaultValue when missing', () => {
    const ctx = createTestExtensionContext();
    expect(ctx.globalState.get<string>('missing', 'fallback')).toBe('fallback');
    expect(ctx.globalState.get<string>('missing')).toBeUndefined();
  });
});

describe('spyOnCommands', () => {
  testEffect(
    'captures executed commands',
    Effect.gen(function* () {
      const spy = spyOnCommands(vscode);
      yield* mod.commands.executeCommand('a', 1);
      yield* mod.commands.executeCommand('b', 2);
      expect(spy.getExecutions().length).toBe(2);
      expect(spy.getExecutionsFor('a').length).toBe(1);
      expect(spy.getExecutionsFor('a')[0]?.args).toEqual([1]);
    }),
  );
});

describe('withContextKeys', () => {
  testEffect(
    'sets keys for the duration of fn and restores',
    Effect.gen(function* () {
      vscode.state.setContextKey('preexisting', 'old');
      let observedInside: Readonly<Record<string, unknown>> = {};
      yield* withContextKeys(
        vscode,
        { preexisting: 'new', extra: 'hello' },
        Effect.sync(() => {
          observedInside = vscode.state.getContextKeys();
        }),
      );
      expect(observedInside).toEqual({ preexisting: 'new', extra: 'hello' });
      expect(vscode.state.getContextKeys()).toEqual({ preexisting: 'old' });
    }),
  );
});
