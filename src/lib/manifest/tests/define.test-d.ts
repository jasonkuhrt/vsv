// Type-level tests for `defineManifest` — Surface B. The `<const M>` tuple
// capture is the foundation the whole runtime/builder typing rests on: if a
// decl factory fails to capture its literal, or the tuple widens to
// `ReadonlyArray`, every downstream extractor degrades. This file is the
// regression fence for that foundation.

import { Schema } from 'effect';
import { describe, expectTypeOf, test } from 'vitest';
import { CommandDecl } from '#lib/manifest/decls/command';
import { ConfigDecl } from '#lib/manifest/decls/config';
import { ContextKeyDecl } from '#lib/manifest/decls/context-key';
import { ExternalCommandDecl } from '#lib/manifest/decls/external-command';
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key';
import { ForeignConfigDecl } from '#lib/manifest/decls/foreign-config';
import { StateDecl } from '#lib/manifest/decls/state';
import { defineManifest } from '#lib/manifest/define';
import type {
  CommandRegistryOf,
  ContextKeyRegistryOf,
  StateRegistryOf,
} from '#lib/runtime/registries';

const m = defineManifest({
  name: 'x',
  publisher: 'y',
  commands: [
    CommandDecl({ id: 'cmd1', args: Schema.String, result: Schema.Void }),
    CommandDecl({ id: 'cmd2', args: Schema.Finite, result: Schema.Void }),
  ],
  externalCommands: [
    ExternalCommandDecl({ id: 'ext1', args: Schema.Void, result: Schema.Void }),
  ],
  contextKeys: [ContextKeyDecl({ name: 'ck1', valueType: Schema.Boolean })],
  externalContextKeys: [
    ExternalContextKeyDecl({ name: 'eck1', valueType: Schema.Boolean }),
  ],
  config: [ConfigDecl({ key: 'cfg1', valueSchema: Schema.Boolean })],
  foreignConfig: [
    ForeignConfigDecl({ fullKey: 'editor.fc1', valueSchema: Schema.Boolean }),
  ],
  state: [
    StateDecl({ key: 'st1', scope: 'workspace', valueSchema: Schema.Finite }),
  ],
});

type M = typeof m;

describe('TypedManifest', () => {
  test('adds the Manifest discriminator', () => {
    expectTypeOf<M['_tag']>().toEqualTypeOf<'Manifest'>();
  });
});

describe('tuple capture', () => {
  test('decl arrays are fixed-length tuples, not widened ReadonlyArrays', () => {
    // A tuple has a numeric-literal `length`; a widened `ReadonlyArray` has
    // `number`. This is the fixture's own canary — if `<const M>` capture
    // regresses, downstream cases would pass vacuously against widened types.
    expectTypeOf<M['commands']['length']>().toEqualTypeOf<2>();
    expectTypeOf<M['externalCommands']['length']>().toEqualTypeOf<1>();
    expectTypeOf<M['contextKeys']['length']>().toEqualTypeOf<1>();
  });

  test('each tuple element keeps its own captured generics', () => {
    // Element 0 and element 1 are distinct decls — neither the widened
    // default nor each other.
    expectTypeOf<M['commands'][0]['args']>().toEqualTypeOf<
      typeof Schema.String
    >();
    expectTypeOf<M['commands'][1]['args']>().toEqualTypeOf<
      typeof Schema.Finite
    >();
    expectTypeOf<M['commands'][0]['args']>().not.toEqualTypeOf<
      M['commands'][1]['args']
    >();
  });
});

describe('decl factory literal capture (through defineManifest)', () => {
  test('CommandDecl captures the id literal', () => {
    expectTypeOf<M['commands'][0]['id']>().toEqualTypeOf<'cmd1'>();
    expectTypeOf<M['commands'][1]['id']>().toEqualTypeOf<'cmd2'>();
  });

  test('ExternalCommandDecl captures the id literal', () => {
    expectTypeOf<M['externalCommands'][0]['id']>().toEqualTypeOf<'ext1'>();
  });

  test('ContextKeyDecl / ExternalContextKeyDecl capture the name literal', () => {
    expectTypeOf<M['contextKeys'][0]['name']>().toEqualTypeOf<'ck1'>();
    expectTypeOf<M['externalContextKeys'][0]['name']>().toEqualTypeOf<'eck1'>();
  });

  test('ConfigDecl / ForeignConfigDecl capture the key literal', () => {
    expectTypeOf<M['config'][0]['key']>().toEqualTypeOf<'cfg1'>();
    expectTypeOf<
      M['foreignConfig'][0]['fullKey']
    >().toEqualTypeOf<'editor.fc1'>();
  });

  test('StateDecl captures the key and scope literals', () => {
    expectTypeOf<M['state'][0]['key']>().toEqualTypeOf<'st1'>();
    expectTypeOf<M['state'][0]['scope']>().toEqualTypeOf<'workspace'>();
  });
});

type RegistryKeys<M> = [
  keyof CommandRegistryOf<M>,
  keyof ContextKeyRegistryOf<M>,
  keyof StateRegistryOf<M>,
];

describe('omitted decl arrays', () => {
  const empty = defineManifest({ name: 'e', publisher: 'p' });
  type E = typeof empty;

  test('a manifest omitting a decl array yields an empty registry — no keys, no crash', () => {
    expectTypeOf<RegistryKeys<E>>().toEqualTypeOf<[never, never, never]>();
  });
});
