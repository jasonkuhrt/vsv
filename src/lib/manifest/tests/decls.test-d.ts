// Type-level tests for the decl factories — Surface A of the type-test plan.
//
// These are inference tests: call the factory API, assert what TypeScript
// infers on the returned decl. A factory that fails to capture its generics
// widens `id`/`name` to `string` and `args`/`valueType` to
// `Schema.Schema.AnyNoContext` (decoded type `any`) — both caught here.
//
// `not.toBeAny()` is asserted on the *decoded* type of each captured schema,
// not the schema field itself: a schema value is never `any`, but a schema
// that fell back to `AnyNoContext` decodes to `any` — that is the failure
// this guard catches.

import { Schema } from 'effect'
import { describe, expectTypeOf, test } from 'vitest'
import { CommandDecl } from '#lib/manifest/decls/command'
import { ConfigDecl } from '#lib/manifest/decls/config'
import { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import { ExternalCommandDecl } from '#lib/manifest/decls/external-command'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { ForeignConfigDecl } from '#lib/manifest/decls/foreign-config'
import { MenuDecl } from '#lib/manifest/decls/menu'
import { StateDecl } from '#lib/manifest/decls/state'
import { WhenBoolKey } from '#lib/when/when'

type DecodedOf<S> = S extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<S> : never

describe('CommandDecl factory', () => {
  test('captures id literal + args/result schemas', () => {
    const d = CommandDecl({
      id: 'cmd.x',
      args: Schema.Struct({ n: Schema.String }),
      result: Schema.Number,
    })
    expectTypeOf(d.id).toEqualTypeOf<'cmd.x'>()
    expectTypeOf(d.args).toEqualTypeOf<Schema.Struct<{ n: typeof Schema.String }>>()
    expectTypeOf(d.result).toEqualTypeOf<typeof Schema.Number>()
    // Decoded types are narrow — not the `any` of an AnyNoContext fallback.
    expectTypeOf<DecodedOf<typeof d.args>>().not.toBeAny()
    expectTypeOf<DecodedOf<typeof d.args>>().toEqualTypeOf<{ readonly n: string }>()
    expectTypeOf<DecodedOf<typeof d.result>>().toEqualTypeOf<number>()
  })

  test('rejects a non-Schema args', () => {
    // @ts-expect-error -- 42 is not an Effect Schema
    CommandDecl({ id: 'cmd.x', args: 42, result: Schema.Void })
  })
})

describe('ExternalCommandDecl factory', () => {
  test('captures id literal + args/result schemas', () => {
    const d = ExternalCommandDecl({
      id: 'ext.x',
      args: Schema.Tuple(Schema.String),
      result: Schema.Void,
    })
    expectTypeOf(d.id).toEqualTypeOf<'ext.x'>()
    expectTypeOf<DecodedOf<typeof d.args>>().not.toBeAny()
    expectTypeOf<DecodedOf<typeof d.args>>().toEqualTypeOf<readonly [string]>()
    expectTypeOf<DecodedOf<typeof d.result>>().toEqualTypeOf<void>()
  })

  test('rejects a non-Schema result', () => {
    // @ts-expect-error -- 'nope' is not an Effect Schema
    ExternalCommandDecl({ id: 'ext.x', args: Schema.Void, result: 'nope' })
  })
})

describe('ContextKeyDecl factory', () => {
  test('captures name literal + valueType schema', () => {
    const d = ContextKeyDecl({ name: 'ck.x', valueType: Schema.Literal('a', 'b') })
    expectTypeOf(d.name).toEqualTypeOf<'ck.x'>()
    expectTypeOf<DecodedOf<typeof d.valueType>>().not.toBeAny()
    expectTypeOf<DecodedOf<typeof d.valueType>>().toEqualTypeOf<'a' | 'b'>()
  })

  test('rejects a non-Schema valueType', () => {
    // @ts-expect-error -- a plain string is not an Effect Schema
    ContextKeyDecl({ name: 'ck.x', valueType: 'boolean' })
  })
})

describe('ExternalContextKeyDecl factory', () => {
  test('captures name literal + valueType schema', () => {
    const d = ExternalContextKeyDecl({ name: 'eck.x', valueType: Schema.Boolean })
    expectTypeOf(d.name).toEqualTypeOf<'eck.x'>()
    expectTypeOf<DecodedOf<typeof d.valueType>>().not.toBeAny()
    expectTypeOf<DecodedOf<typeof d.valueType>>().toEqualTypeOf<boolean>()
  })

  test('rejects a non-Schema valueType', () => {
    // @ts-expect-error -- `true` is not an Effect Schema
    ExternalContextKeyDecl({ name: 'eck.x', valueType: true })
  })
})

describe('ConfigDecl factory', () => {
  test('captures key literal + valueSchema', () => {
    const d = ConfigDecl({ key: 'cfg.x', valueSchema: Schema.Boolean })
    expectTypeOf(d.key).toEqualTypeOf<'cfg.x'>()
    expectTypeOf<DecodedOf<typeof d.valueSchema>>().not.toBeAny()
    expectTypeOf<DecodedOf<typeof d.valueSchema>>().toEqualTypeOf<boolean>()
  })

  test('rejects a non-Schema valueSchema', () => {
    // @ts-expect-error -- 0 is not an Effect Schema
    ConfigDecl({ key: 'cfg.x', valueSchema: 0 })
  })
})

describe('ForeignConfigDecl factory', () => {
  test('captures fullKey literal + valueSchema', () => {
    const d = ForeignConfigDecl({ fullKey: 'editor.x', valueSchema: Schema.Number })
    expectTypeOf(d.fullKey).toEqualTypeOf<'editor.x'>()
    expectTypeOf<DecodedOf<typeof d.valueSchema>>().not.toBeAny()
    expectTypeOf<DecodedOf<typeof d.valueSchema>>().toEqualTypeOf<number>()
  })

  test('rejects a non-Schema valueSchema', () => {
    // @ts-expect-error -- {} is not an Effect Schema
    ForeignConfigDecl({ fullKey: 'editor.x', valueSchema: {} })
  })
})

describe('StateDecl factory', () => {
  test('captures key literal, scope literal, and valueSchema', () => {
    const d = StateDecl({ key: 'st.x', scope: 'workspace', valueSchema: Schema.Number })
    expectTypeOf(d.key).toEqualTypeOf<'st.x'>()
    expectTypeOf(d.scope).toEqualTypeOf<'workspace'>()
    expectTypeOf<DecodedOf<typeof d.valueSchema>>().not.toBeAny()
    expectTypeOf<DecodedOf<typeof d.valueSchema>>().toEqualTypeOf<number>()
  })

  test('captures the global scope literal', () => {
    const d = StateDecl({ key: 'st.y', scope: 'global', valueSchema: Schema.String })
    expectTypeOf(d.scope).toEqualTypeOf<'global'>()
  })

  test('rejects a non-Schema valueSchema', () => {
    // @ts-expect-error -- null is not an Effect Schema
    StateDecl({ key: 'st.x', scope: 'global', valueSchema: null })
  })

  test('rejects an unknown scope', () => {
    // @ts-expect-error -- 'session' is not a valid scope
    StateDecl({ key: 'st.x', scope: 'session', valueSchema: Schema.Number })
  })
})

describe('MenuDecl factory', () => {
  test('captures location + command literals', () => {
    const d = MenuDecl({
      location: 'explorer/context',
      command: 'ext.delete',
      when: WhenBoolKey.make({ key: 'explorerResourceIsFolder' }),
      group: 'navigation',
    })
    expectTypeOf(d.location).toEqualTypeOf<'explorer/context'>()
    expectTypeOf(d.command).toEqualTypeOf<'ext.delete'>()
  })

  test('when/group are optional', () => {
    const d = MenuDecl({ location: 'commandPalette', command: 'ext.run' })
    expectTypeOf(d.location).toEqualTypeOf<'commandPalette'>()
    expectTypeOf(d.command).toEqualTypeOf<'ext.run'>()
  })

  test('rejects a non-WhenAst when', () => {
    // @ts-expect-error -- a raw string is not a WhenAst (must be built via When(manifest))
    MenuDecl({ location: 'commandPalette', command: 'ext.run', when: 'inputFocus' })
  })
})
