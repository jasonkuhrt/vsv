// Type-level tests for the `When` builder's manifest-derived types.
//
// The method-level narrowing (`eq` value domain, `match`/`lt` key gating) is
// covered by `@ts-expect-error` assertions in `builder.test.ts`. This file
// covers the standalone type extractors that back those methods.

import { Schema } from 'effect'
import { describe, expectTypeOf, test } from 'vitest'
import { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { defineManifest } from '#lib/manifest/define'
import type {
  ContextKeyName,
  ContextKeyValue,
  NumericKeyName,
  OpenStringKeyName,
} from '#lib/when/builder'

// Context keys spanning every value domain the builder discriminates.
const m = defineManifest({
  name: 'tm',
  publisher: 'p',
  contextKeys: [
    ContextKeyDecl({ name: 'ck.bool', valueType: Schema.Boolean }),
    ContextKeyDecl({ name: 'ck.enum', valueType: Schema.Literal('a', 'b') }),
    ContextKeyDecl({ name: 'ck.str', valueType: Schema.String }),
    ContextKeyDecl({ name: 'ck.num', valueType: Schema.Number }),
    ContextKeyDecl({ name: 'ck.numEnum', valueType: Schema.Literal(1, 2) }),
  ],
  externalContextKeys: [
    ExternalContextKeyDecl({ name: 'eck.str', valueType: Schema.String }),
    // Same name twice — the value domain must merge to the union.
    ExternalContextKeyDecl({ name: 'eck.merged', valueType: Schema.Literal('x') }),
    ExternalContextKeyDecl({ name: 'eck.merged', valueType: Schema.Literal('y') }),
  ],
})

type M = typeof m

describe('ContextKeyName', () => {
  test('unions owned + external context-key names', () => {
    expectTypeOf<ContextKeyName<M>>().toEqualTypeOf<
      'ck.bool' | 'ck.enum' | 'ck.str' | 'ck.num' | 'ck.numEnum' | 'eck.str' | 'eck.merged'
    >()
  })

  test('is never for a manifest with no context keys', () => {
    const empty = defineManifest({ name: 'e', publisher: 'p' })
    expectTypeOf<ContextKeyName<typeof empty>>().toBeNever()
  })
})

describe('ContextKeyValue', () => {
  test('extracts the decoded value type — not any', () => {
    expectTypeOf<ContextKeyValue<M, 'ck.bool'>>().not.toBeAny()
    expectTypeOf<ContextKeyValue<M, 'ck.bool'>>().toEqualTypeOf<boolean>()
    expectTypeOf<ContextKeyValue<M, 'ck.enum'>>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<ContextKeyValue<M, 'ck.str'>>().toEqualTypeOf<string>()
    expectTypeOf<ContextKeyValue<M, 'ck.num'>>().toEqualTypeOf<number>()
    expectTypeOf<ContextKeyValue<M, 'ck.numEnum'>>().toEqualTypeOf<1 | 2>()
    expectTypeOf<ContextKeyValue<M, 'eck.str'>>().toEqualTypeOf<string>()
  })

  test('merges same-named decls into the value union', () => {
    expectTypeOf<ContextKeyValue<M, 'eck.merged'>>().toEqualTypeOf<'x' | 'y'>()
  })
})

describe('NumericKeyName', () => {
  test('selects keys whose value domain is numeric — open number or numeric literal', () => {
    expectTypeOf<NumericKeyName<M>>().toEqualTypeOf<'ck.num' | 'ck.numEnum'>()
  })
})

describe('OpenStringKeyName', () => {
  test('selects keys whose value domain is the open string type, not a closed enum', () => {
    expectTypeOf<OpenStringKeyName<M>>().toEqualTypeOf<'ck.str' | 'eck.str'>()
  })
})
