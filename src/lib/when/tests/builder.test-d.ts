// Type-level tests for the `When` builder — Surface E.
//
// Two layers: the standalone type extractors (`ContextKeyName`,
// `ContextKeyValue`, `NumericKeyName`, `OpenStringKeyName`), and — the layer
// that matters most — builder-method inference: call `When(m).eq(...)` etc.
// and assert the key/value constraints TypeScript enforces at the call site.

import { Schema } from 'effect'
import { describe, expectTypeOf, test } from 'vitest'
import { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { defineManifest } from '#lib/manifest/define'
import { OpenEnum } from '#lib/schema/open-enum'
import {
  type ContextKeyName,
  type ContextKeyValue,
  type NumericKeyName,
  type OpenStringKeyName,
  When,
  type WhenBuilder,
} from '#lib/when/builder'
import type { WhenAst } from '#lib/when/when'

// An `OpenEnum`-typed value domain: known core members, open at runtime.
const EditorLangId = OpenEnum('editorLangId', {
  typescript: 'typescript',
  javascript: 'javascript',
  markdown: 'markdown',
})

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
    ContextKeyDecl({ name: 'ck.openEnum', valueType: EditorLangId }),
  ],
  externalContextKeys: [
    ExternalContextKeyDecl({ name: 'eck.str', valueType: Schema.String }),
    // Same name twice — the value domain must merge to the union.
    ExternalContextKeyDecl({ name: 'eck.merged', valueType: Schema.Literal('x') }),
    ExternalContextKeyDecl({ name: 'eck.merged', valueType: Schema.Literal('y') }),
  ],
})

type M = typeof m

// Fixture canary — see registries.test-d.ts.
describe('fixture', () => {
  test('contextKeys captured as a fixed-length tuple', () => {
    expectTypeOf<M['contextKeys']['length']>().toEqualTypeOf<6>()
  })
})

// ─── Type extractors ─────────────────────────────────────────────────────

describe('ContextKeyName', () => {
  test('unions owned + external context-key names', () => {
    expectTypeOf<ContextKeyName<M>>().toEqualTypeOf<
      | 'ck.bool'
      | 'ck.enum'
      | 'ck.str'
      | 'ck.num'
      | 'ck.numEnum'
      | 'ck.openEnum'
      | 'eck.str'
      | 'eck.merged'
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

  test('an OpenEnum key decodes to the tagged read struct — NOT the authoring union', () => {
    // `ContextKeyValue` is the *read* (decoded) domain: the tagged
    // parse-don't-validate struct. The *authoring* projection (the bare
    // string union) is asserted on the `eq` value argument below, not here.
    expectTypeOf<ContextKeyValue<M, 'ck.openEnum'>>().toEqualTypeOf<
      | { readonly value: 'typescript' | 'javascript' | 'markdown' }
      | { readonly found: string; readonly value: 'unknown' }
    >()
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

// ─── Builder-method inference ────────────────────────────────────────────

const $ = When(m)

describe('When', () => {
  test('builder is typed to the manifest', () => {
    // The annotation asserts assignability; the typo below is the decisive
    // proof `M` was captured rather than erased to `AnyTypedManifest`.
    const typed: WhenBuilder<M> = When(m)
    void typed
    // @ts-expect-error -- 'ck.nope' is not a declared context key
    $.is('ck.nope')
  })
})

describe('is', () => {
  test('produces a WhenAst for a declared key', () => {
    expectTypeOf($.is('ck.bool')).toEqualTypeOf<WhenAst>()
  })

  test('rejects an undeclared key', () => {
    // @ts-expect-error -- 'ck.nope' is not declared
    $.is('ck.nope')
  })
})

describe('eq', () => {
  test('value is narrowed to a boolean key domain', () => {
    $.eq('ck.bool', true)
    // @ts-expect-error -- a boolean key rejects a string value
    $.eq('ck.bool', 'yes')
  })

  test('value is narrowed to a literal key domain', () => {
    $.eq('ck.enum', 'a')
    $.eq('ck.enum', 'b')
    // @ts-expect-error -- 'z' is not a declared literal of 'ck.enum'
    $.eq('ck.enum', 'z')
  })

  test('value accepts the merged union across same-named decls', () => {
    $.eq('eck.merged', 'x')
    $.eq('eck.merged', 'y')
    // @ts-expect-error -- 'z' was declared by neither 'eck.merged' decl
    $.eq('eck.merged', 'z')
  })

  test('an OpenEnum key autocompletes known members AND accepts any string', () => {
    // Known core members type-check (these are the autocomplete suggestions).
    $.eq('ck.openEnum', 'typescript')
    $.eq('ck.openEnum', 'javascript')
    $.eq('ck.openEnum', 'markdown')
    // An unmodeled value is still accepted — a `when` clause may legitimately
    // compare a value outside the core membership. This is the decisive
    // contrast with the closed `ck.enum` literal key below.
    $.eq('ck.openEnum', 'some-language-not-in-the-core-set')
    // The tagged read struct is NOT a valid authoring argument.
    // @ts-expect-error -- the decoded struct is for *reading*, not authoring
    $.eq('ck.openEnum', { value: 'typescript' })
    // The value argument is the bare known union widened with an open-string
    // escape — `string & {}` keeps the literal suggestions while admitting any
    // string. (A boolean/number is still rejected: the domain is string-only.)
    expectTypeOf<Parameters<typeof $.eq<'ck.openEnum'>>[1]>().toEqualTypeOf<
      'typescript' | 'javascript' | 'markdown' | (string & {})
    >()
    // @ts-expect-error -- the OpenEnum authoring domain is string-only
    $.eq('ck.openEnum', 42)
  })

  test('a closed Literal key still rejects non-members (no open-string escape)', () => {
    // The contrast that proves the OpenEnum escape is specific to OpenEnum
    // keys: a plain `Schema.Literal` key keeps its closed union and rejects
    // any string outside it.
    $.eq('ck.enum', 'a')
    // @ts-expect-error -- 'nope' is not a declared literal; closed keys have no open escape
    $.eq('ck.enum', 'nope')
  })

  test('a Boolean key still takes a boolean', () => {
    $.eq('ck.bool', true)
    $.eq('ck.bool', false)
    expectTypeOf<Parameters<typeof $.eq<'ck.bool'>>[1]>().toEqualTypeOf<boolean>()
    // @ts-expect-error -- a boolean key rejects a string value
    $.eq('ck.bool', 'true')
  })
})

describe('match', () => {
  test('compiles for an open-string key', () => {
    expectTypeOf($.match('ck.str', 'pat')).toEqualTypeOf<WhenAst>()
  })

  test('rejects a boolean key', () => {
    // @ts-expect-error -- a boolean key is not an open-string key
    $.match('ck.bool', 'pat')
  })

  test('rejects a closed literal-enum key', () => {
    // @ts-expect-error -- a literal-enum key is not an open-string key
    $.match('ck.enum', 'pat')
  })
})

describe('comparisons (lt/lte/gt/gte)', () => {
  test('compile for a numeric key — open number or numeric literal', () => {
    expectTypeOf($.lt('ck.num', 1)).toEqualTypeOf<WhenAst>()
    $.lte('ck.num', 1)
    $.gt('ck.num', 1)
    $.gte('ck.num', 1)
    $.gt('ck.numEnum', 1)
  })

  test('reject a boolean key', () => {
    // @ts-expect-error -- a boolean key is not numeric
    $.lt('ck.bool', 1)
  })

  test('reject a string key', () => {
    // @ts-expect-error -- a string key is not numeric
    $.gt('ck.str', 1)
  })
})

describe('in', () => {
  test('compiles for two declared keys', () => {
    expectTypeOf($.in('ck.str', 'ck.bool')).toEqualTypeOf<WhenAst>()
  })

  test('rejects an undeclared key on either side', () => {
    // @ts-expect-error -- 'ck.nope' is not declared
    $.in('ck.str', 'ck.nope')
  })
})

describe('combinators', () => {
  test('not/and/or take WhenAst and return WhenAst', () => {
    const a = $.is('ck.bool')
    const b = $.is('ck.str')
    expectTypeOf($.not(a)).toEqualTypeOf<WhenAst>()
    expectTypeOf($.and(a, b)).toEqualTypeOf<WhenAst>()
    expectTypeOf($.or(a, b)).toEqualTypeOf<WhenAst>()
  })
})

describe('unsafe.raw', () => {
  test('accepts any string — the escape hatch stays untyped by design', () => {
    expectTypeOf($.unsafe.raw).parameter(0).toEqualTypeOf<string>()
    expectTypeOf($.unsafe.raw('any string at all')).toEqualTypeOf<WhenAst>()
  })
})
