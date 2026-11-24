// Type-level tests for `createRuntime` — Surface D, the inference epicenter.
//
// These are the tests that mirror what a consumer experiences: call the
// runtime API, assert what TypeScript infers at the call site. The original
// `any` leak — `defineContextKey().get` yielding `any` — surfaced exactly
// here, in a consumer, not in the extractor. `defineContextKey` below is the
// regression fence for it.

import type { Layer } from 'effect';
import { Effect, Schema } from 'effect';
import { describe, expectTypeOf, test } from 'vitest';
import type * as vscode from 'vscode';
import { CommandDecl } from '#lib/manifest/decls/command';
import { ConfigDecl } from '#lib/manifest/decls/config';
import { ContextKeyDecl } from '#lib/manifest/decls/context-key';
import { ExternalCommandDecl } from '#lib/manifest/decls/external-command';
import { ForeignConfigDecl } from '#lib/manifest/decls/foreign-config';
import { StateDecl } from '#lib/manifest/decls/state';
import { defineManifest } from '#lib/manifest/define';
import {
  type ConfigHandle,
  type ContextKeyHandle,
  createRuntime,
  type Runtime,
  type StateHandle,
} from '#lib/runtime/create';
import type { VSCodeHost } from '../vscode-host.ts';

declare const testLayer: Layer.Layer<VSCodeHost>;

const m = defineManifest({
  name: 'tm',
  publisher: 'p',
  commands: [
    CommandDecl({
      id: 'cmd.greet',
      args: Schema.Struct({ name: Schema.String }),
      result: Schema.String,
    }),
  ],
  externalCommands: [
    ExternalCommandDecl({
      id: 'ext.noop',
      args: Schema.Void,
      result: Schema.Void,
    }),
    ExternalCommandDecl({
      id: 'ext.move',
      args: Schema.Tuple([Schema.String]),
      result: Schema.Void,
    }),
  ],
  contextKeys: [
    ContextKeyDecl({ name: 'ck.bool', valueType: Schema.Boolean }),
    ContextKeyDecl({ name: 'ck.enum', valueType: Schema.Literals(['a', 'b']) }),
  ],
  config: [ConfigDecl({ key: 'cfg.enabled', valueSchema: Schema.Boolean })],
  foreignConfig: [
    ForeignConfigDecl({
      fullKey: 'editor.fontSize',
      valueSchema: Schema.Finite,
    }),
  ],
  state: [
    StateDecl({ key: 'st.count', scope: 'global', valueSchema: Schema.Finite }),
  ],
});

type M = typeof m;

// `declare` — vitest typecheck never executes this file, so no value of
// `ExtensionContext` is needed. It cannot live inside a `describe` callback
// (a block scope rejects the `declare` modifier).
declare const ctx: vscode.ExtensionContext;

// Fixture canary — see registries.test-d.ts.
describe('fixture', () => {
  test('decl arrays are captured as fixed-length tuples', () => {
    expectTypeOf<M['commands']['length']>().toEqualTypeOf<1>();
    expectTypeOf<M['contextKeys']['length']>().toEqualTypeOf<2>();
  });
});

describe('createRuntime', () => {
  test('captures the manifest — methods narrow to its declared keys', () => {
    const r = Effect.runSync(Effect.provide(createRuntime(m), testLayer));
    // The decisive proof `M` was captured rather than erased to
    // `AnyTypedManifest`: `defineContextKey` is constrained to THIS
    // manifest's context keys. On `Runtime<AnyTypedManifest>` the key slot
    // widens to `string` and the line below would compile.
    void r.defineContextKey('ck.enum', 'a');
    // @ts-expect-error -- 'ck.nope' is not a declared context key
    void r.defineContextKey('ck.nope', false);
  });
});

const rt: Runtime<M> = Effect.runSync(
  Effect.provide(createRuntime(m), testLayer),
);

describe('defineCommand', () => {
  test('handler args param is the inferred decoded type — not any', () => {
    void rt.defineCommand('cmd.greet', (args) => {
      expectTypeOf(args).not.toBeAny();
      expectTypeOf(args).toEqualTypeOf<{ readonly name: string }>();
      return Effect.succeed('ok');
    });
  });

  test('handler must return an Effect of the declared result type', () => {
    void rt.defineCommand('cmd.greet', () => Effect.succeed('ok'));
    // @ts-expect-error -- declared result is string; handler returns Effect<number>
    void rt.defineCommand('cmd.greet', () => Effect.succeed(42));
  });

  test('rejects an undeclared command id', () => {
    // @ts-expect-error -- 'cmd.nope' is not a declared command
    void rt.defineCommand('cmd.nope', () => Effect.succeed('ok'));
  });
});

describe('executeCommand', () => {
  test('args param is the inferred decoded type; success is the declared result', () => {
    const out = Effect.runSync(rt.executeCommand('cmd.greet', { name: 'x' }));
    expectTypeOf(out).not.toBeAny();
    expectTypeOf(out).toEqualTypeOf<string>();
  });

  test('rejects a mistyped args object', () => {
    // @ts-expect-error -- `name` must be a string
    void rt.executeCommand('cmd.greet', { name: 42 });
  });

  test('rejects an undeclared command id', () => {
    // @ts-expect-error -- 'cmd.nope' is not declared
    void rt.executeCommand('cmd.nope', undefined);
  });
});

describe('defineContextKey — the regression epicenter', () => {
  test('rejects an undeclared key', () => {
    // @ts-expect-error -- 'ck.nope' is not a declared context key
    void rt.defineContextKey('ck.nope', false);
  });

  test('initialValue is narrowed to the key value domain', () => {
    void rt.defineContextKey('ck.enum', 'a');
    void rt.defineContextKey('ck.bool', true);
    // @ts-expect-error -- 'ck.enum' domain is 'a' | 'b'
    void rt.defineContextKey('ck.enum', 'z');
    // @ts-expect-error -- 'ck.bool' domain is boolean
    void rt.defineContextKey('ck.bool', 'yes');
  });

  test('handle is ContextKeyHandle over the narrow value type', () => {
    const handle = Effect.runSync(rt.defineContextKey('ck.enum', 'a'));
    expectTypeOf(handle).toEqualTypeOf<ContextKeyHandle<'a' | 'b'>>();
  });

  test('.get yields the narrow value — THE case that shipped broken', () => {
    const handle = Effect.runSync(rt.defineContextKey('ck.enum', 'a'));
    const got = Effect.runSync(handle.get);
    expectTypeOf(got).not.toBeAny();
    expectTypeOf(got).toEqualTypeOf<'a' | 'b'>();
  });

  test('.set requires the narrow value', () => {
    const handle = Effect.runSync(rt.defineContextKey('ck.enum', 'a'));
    void handle.set('b');
    // @ts-expect-error -- 'z' is not in the value domain
    void handle.set('z');
  });

  test('.onChange callback parameter is the narrow value', () => {
    const handle = Effect.runSync(rt.defineContextKey('ck.enum', 'a'));
    void handle.onChange((v) => {
      expectTypeOf(v).not.toBeAny();
      expectTypeOf(v).toEqualTypeOf<'a' | 'b'>();
    });
  });
});

describe('defineConfig / defineForeignConfig', () => {
  test('defineConfig handle is typed to the declared config value', () => {
    const handle = Effect.runSync(rt.defineConfig('cfg.enabled'));
    expectTypeOf(handle).toEqualTypeOf<ConfigHandle<boolean>>();
    const withDefault = Effect.runSync(handle.getWithDefault(false));
    expectTypeOf(withDefault).not.toBeAny();
    expectTypeOf(withDefault).toEqualTypeOf<boolean>();
  });

  test('defineForeignConfig handle is typed to the declared foreign value', () => {
    const handle = Effect.runSync(rt.defineForeignConfig('editor.fontSize'));
    expectTypeOf(handle).toEqualTypeOf<ConfigHandle<number>>();
  });

  test('rejects undeclared config keys', () => {
    // @ts-expect-error -- 'cfg.nope' is not a declared config key
    void rt.defineConfig('cfg.nope');
    // @ts-expect-error -- 'editor.nope' is not a declared foreign config key
    void rt.defineForeignConfig('editor.nope');
  });
});

describe('defineState', () => {
  test('handle is typed to the declared state value', () => {
    const handle = Effect.runSync(rt.defineState(ctx, 'st.count', 'global'));
    expectTypeOf(handle).toEqualTypeOf<StateHandle<number>>();
    const got = Effect.runSync(handle.get);
    expectTypeOf(got).not.toBeAny();
    expectTypeOf(got).toEqualTypeOf<number | undefined>();
  });

  test('scope argument must match the declared scope literal', () => {
    void rt.defineState(ctx, 'st.count', 'global');
    // @ts-expect-error -- 'st.count' was declared with scope 'global'
    void rt.defineState(ctx, 'st.count', 'workspace');
  });

  test('rejects an undeclared state key', () => {
    // @ts-expect-error -- 'st.nope' is not a declared state key
    void rt.defineState(ctx, 'st.nope', 'global');
  });
});

describe('executeExternalCommand', () => {
  test('a void-args command takes no extra arguments', () => {
    void rt.executeExternalCommand('ext.noop');
    // @ts-expect-error -- 'ext.noop' is a void-args command; no positional args
    void rt.executeExternalCommand('ext.noop', 'extra');
  });

  test('a tuple-args command takes exactly the positional tuple', () => {
    void rt.executeExternalCommand('ext.move', 'a-uri');
    // @ts-expect-error -- 'ext.move' needs one string argument
    void rt.executeExternalCommand('ext.move');
  });

  test('rejects an undeclared external command id', () => {
    // @ts-expect-error -- 'ext.nope' is not declared
    void rt.executeExternalCommand('ext.nope');
  });
});
