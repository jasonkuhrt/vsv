// Property-based round-trip tests for the `WhenClause` codec.
//
// Two properties:
//
//   1. String codec — `decode(encode(ast))` is structurally equal to `ast`,
//      generated from `arbWellFormed`: a hand-built arbitrary that yields only
//      ASTs the codec round-trips exactly (identifier-shaped keys, quote-free
//      string values, ≥ 2-term combinators, no `WhenUnsafeRaw`). Building the
//      generator — rather than `Arbitrary.make(WhenAstStruct).filter(...)` —
//      keeps every generated value in the round-trip closure: no filter to
//      starve generation, and every run exercises the codec.
//   2. Struct codec — `decodeStruct(encodeStruct(ast))` equals `ast` for ANY
//      schema-valid ast (`Arbitrary.make`); the structural codec is total.
//
// `WhenUnsafeRaw` round-trip and string-level canonicalization (bare-word RHS
// → quoted, `(a)` → `a`) are covered by explicit cases in `when.test.ts` and
// the fixture corpus's `re-decode is a fixpoint` checks.
//
// Equality is bun's `toEqual` (deep structural) — NOT `Equal.equals`, which
// compares the `terms` array field of WhenAnd/WhenOr by reference.

import { describe, expect, test } from 'bun:test'
import { Arbitrary, FastCheck as fc, Schema } from 'effect'
import {
  type WhenAst,
  WhenAnd,
  WhenAstStruct,
  WhenBoolKey,
  WhenClause,
  WhenCmp,
  WhenEq,
  WhenIn,
  WhenMatch,
  WhenNeq,
  WhenNot,
  WhenOr,
} from '../when.ts'

const encode = Schema.encodeSync(WhenClause)
const decode = Schema.decodeUnknownSync(WhenClause)
const encodeStruct = Schema.encodeSync(WhenAstStruct)
const decodeStruct = Schema.decodeUnknownSync(WhenAstStruct)

// ─── Well-formed AST generator ───────────────────────────────────────────

// Context-key identifier — what the decode regexes accept.
const arbIdent = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_.-]{0,6}$/)
// `==`/`!=` RHS value: a quote-free string, a finite non-`-0` number, or a
// boolean. Quote-free because VS Code's `'…'` literals have no escape syntax.
const arbStr = fc.string({ maxLength: 8 }).filter((s) => !s.includes(`'`))
const arbNum = fc.double().filter((d) => Number.isFinite(d) && !Object.is(d, -0))
const arbValue = fc.oneof(arbStr, arbNum, fc.boolean())
// Regex pattern: non-empty, no `/` (closes the regex) and no `\` (escape
// handling is exercised by the fixture corpus, not here). No whitespace, so
// it satisfies `NonEmptyTrimmedString`.
const arbPattern = fc.stringMatching(/^[A-Za-z0-9^$.*+?|()[\]{}-]{1,10}$/)
const arbFlags = fc.stringMatching(/^[gimsuy]{1,3}$/)

const arbAtom: fc.Arbitrary<WhenAst> = fc.oneof(
  arbIdent.map((key) => WhenBoolKey.make({ key })),
  fc.record({ key: arbIdent, value: arbValue }).map((r) => WhenEq.make(r)),
  fc.record({ key: arbIdent, value: arbValue }).map((r) => WhenNeq.make(r)),
  fc
    .record({ key: arbIdent, pattern: arbPattern, flags: fc.option(arbFlags, { nil: undefined }) })
    .map(({ key, pattern, flags }) =>
      WhenMatch.make(flags === undefined ? { key, pattern } : { key, pattern, flags }),
    ),
  fc.record({ key: arbIdent, set: arbIdent }).map((r) => WhenIn.make(r)),
  fc
    .record({
      key: arbIdent,
      op: fc.constantFrom(...(['<', '<=', '>', '>='] as const)),
      value: arbNum,
    })
    .map((r) => WhenCmp.make(r)),
)

const { ast: arbWellFormed } = fc.letrec<{ ast: WhenAst }>((tie) => ({
  ast: fc.oneof(
    { depthSize: 'small', maxDepth: 4 },
    arbAtom,
    tie('ast').map((inner) => WhenNot.make({ inner })),
    fc.array(tie('ast'), { minLength: 2, maxLength: 4 }).map((terms) => WhenAnd.make({ terms })),
    fc.array(tie('ast'), { minLength: 2, maxLength: 4 }).map((terms) => WhenOr.make({ terms })),
  ),
}))

// ─── Properties ──────────────────────────────────────────────────────────

describe('WhenClause property tests', () => {
  test('string codec: decode(encode(ast)) preserves a well-formed AST', () => {
    fc.assert(
      fc.property(arbWellFormed, (ast) => {
        expect(decode(encode(ast))).toEqual(ast)
      }),
      { numRuns: 500 },
    )
  })

  test('string codec: encode is stable/idempotent — encode(decode(encode(ast))) === encode(ast)', () => {
    fc.assert(
      fc.property(arbWellFormed, (ast) => {
        const once = encode(ast)
        expect(encode(decode(once))).toBe(once)
      }),
      { numRuns: 500 },
    )
  })

  test('struct codec: decodeStruct(encodeStruct(ast)) preserves any AST', () => {
    fc.assert(
      fc.property(Arbitrary.make(WhenAstStruct), (ast) => {
        expect(decodeStruct(encodeStruct(ast))).toEqual(ast)
      }),
      { numRuns: 500 },
    )
  })
})
