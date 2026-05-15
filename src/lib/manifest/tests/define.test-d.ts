// Type-level tests for `defineManifest` — the `<const M>` tuple capture that
// the whole runtime/builder typing rests on. If a decl factory fails to
// capture its identifying literal, every downstream extractor degrades; this
// file is the regression fence for that foundation.

import { Schema } from 'effect'
import { describe, expectTypeOf, test } from 'vitest'
import { CommandDecl } from '#lib/manifest/decls/command'
import { ConfigDecl } from '#lib/manifest/decls/config'
import { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import { ExternalCommandDecl } from '#lib/manifest/decls/external-command'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { ForeignConfigDecl } from '#lib/manifest/decls/foreign-config'
import { StateDecl } from '#lib/manifest/decls/state'
import { defineManifest } from '#lib/manifest/define'

const m = defineManifest({
  name: 'x',
  publisher: 'y',
  commands: [
    CommandDecl({ id: 'cmd1', args: Schema.String, result: Schema.Void }),
    CommandDecl({ id: 'cmd2', args: Schema.Number, result: Schema.Void }),
  ],
  externalCommands: [ExternalCommandDecl({ id: 'ext1', args: Schema.Void, result: Schema.Void })],
  contextKeys: [ContextKeyDecl({ name: 'ck1', valueType: Schema.Boolean })],
  externalContextKeys: [ExternalContextKeyDecl({ name: 'eck1', valueType: Schema.Boolean })],
  config: [ConfigDecl({ key: 'cfg1', valueSchema: Schema.Boolean })],
  foreignConfig: [ForeignConfigDecl({ fullKey: 'editor.fc1', valueSchema: Schema.Boolean })],
  state: [StateDecl({ key: 'st1', scope: 'workspace', valueSchema: Schema.Number })],
})

type M = typeof m

describe('TypedManifest', () => {
  test('adds the Manifest discriminator', () => {
    expectTypeOf<M['_tag']>().toEqualTypeOf<'Manifest'>()
  })

  test('preserves the decl arrays as tuples — a literal-length, not ReadonlyArray', () => {
    // A tuple has a numeric-literal `length`; a widened array has `number`.
    expectTypeOf<M['commands']['length']>().toEqualTypeOf<2>()
  })
})

describe('decl factory literal capture', () => {
  test('CommandDecl captures the id literal', () => {
    expectTypeOf<M['commands'][0]['id']>().toEqualTypeOf<'cmd1'>()
    expectTypeOf<M['commands'][1]['id']>().toEqualTypeOf<'cmd2'>()
  })

  test('ExternalCommandDecl captures the id literal', () => {
    expectTypeOf<M['externalCommands'][0]['id']>().toEqualTypeOf<'ext1'>()
  })

  test('ContextKeyDecl / ExternalContextKeyDecl capture the name literal', () => {
    expectTypeOf<M['contextKeys'][0]['name']>().toEqualTypeOf<'ck1'>()
    expectTypeOf<M['externalContextKeys'][0]['name']>().toEqualTypeOf<'eck1'>()
  })

  test('ConfigDecl / ForeignConfigDecl capture the key literal', () => {
    expectTypeOf<M['config'][0]['key']>().toEqualTypeOf<'cfg1'>()
    expectTypeOf<M['foreignConfig'][0]['fullKey']>().toEqualTypeOf<'editor.fc1'>()
  })

  test('StateDecl captures the key and scope literals', () => {
    expectTypeOf<M['state'][0]['key']>().toEqualTypeOf<'st1'>()
    expectTypeOf<M['state'][0]['scope']>().toEqualTypeOf<'workspace'>()
  })
})
