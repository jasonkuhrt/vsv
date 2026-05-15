// oxlint-disable typescript/no-unsafe-declaration-merging -- TaggedClass + recursive AST
// requires merged interface/class declarations so `Schema.suspend(() => WhenAstStruct)`
// has a concrete return-type annotation that breaks the value-side recursion cycle.
//
// VS Code `when`-clause AST + bidirectional string codec.
//
// VS Code gates keybindings, menu items, and view visibility on a small
// total expression language over a heterogeneous context-key store. This
// module models that language as a discriminated union of TaggedClasses
// and exposes a single Effect Schema codec (`WhenClause`) that round-trips
// between AST values and their canonical when-clause strings.
//
// Two layers:
//
//   - `WhenAstStruct` — pure structural schema. Encoded form is the same
//     tagged-struct shape as the decoded form. Use this when you want to
//     manipulate, serialize-as-JSON, or pattern-match the AST without
//     touching string syntax.
//
//   - `WhenClause` — bidirectional codec layered on top via per-variant
//     `Schema.transformOrFail` whose decoded side is the variant's
//     TaggedClass. Encoded form is `string` (VS Code's clause syntax),
//     decoded form is `WhenAst`. Public API:
//
//       Schema.encodeSync(WhenClause)(ast)              // AST -> string
//       Schema.decodeUnknownSync(WhenClause)(text)      // string -> AST
//
// There is no exported `serialize` or `parse` function. The schema IS
// the codec — per-variant `decode`/`encode` are the bidirectional spec,
// and combinators recurse via `Schema.encode(WhenClause)` /
// `Schema.decodeUnknown(WhenClause)` on their children.

import { Effect, ParseResult, pipe, Schema } from 'effect'

// ─── Forward interface declarations (required for recursion via suspend) ─

export interface WhenBoolKey {
  readonly _tag: 'WhenBoolKey'
  readonly key: string
}
export interface WhenEq {
  readonly _tag: 'WhenEq'
  readonly key: string
  readonly value: string | number | boolean
}
export interface WhenNeq {
  readonly _tag: 'WhenNeq'
  readonly key: string
  readonly value: string | number | boolean
}
export interface WhenMatch {
  readonly _tag: 'WhenMatch'
  readonly key: string
  readonly pattern: string
  readonly flags?: string | undefined
}
export interface WhenIn {
  readonly _tag: 'WhenIn'
  readonly key: string
  readonly set: string
}
export interface WhenCmp {
  readonly _tag: 'WhenCmp'
  readonly key: string
  readonly op: '<' | '<=' | '>' | '>='
  readonly value: number
}
export interface WhenNot {
  readonly _tag: 'WhenNot'
  readonly inner: WhenAst
}
export interface WhenAnd {
  readonly _tag: 'WhenAnd'
  readonly terms: ReadonlyArray<WhenAst>
}
export interface WhenOr {
  readonly _tag: 'WhenOr'
  readonly terms: ReadonlyArray<WhenAst>
}
export interface WhenUnsafeRaw {
  readonly _tag: 'WhenUnsafeRaw'
  readonly text: string
}

export type WhenAst =
  | WhenBoolKey
  | WhenEq
  | WhenNeq
  | WhenMatch
  | WhenIn
  | WhenCmp
  | WhenNot
  | WhenAnd
  | WhenOr
  | WhenUnsafeRaw

// ─── Internal helpers (private to the module) ────────────────────────────

// Identifier (context-key name). VS Code's actual identifier surface
// (scanner.ts `_string`) is a wide charset including hyphens, dots, `<>/\:`
// etc. We accept the common subset that real-world extensions use; anything
// outside falls through to WhenUnsafeRaw. The hyphen extends what 1b59ffb
// shipped — `auxiliary-bar-visible`-style keys are widespread in VS Code core.
const KEY = '[A-Za-z_][\\w.-]*'
// Numeric literal — matches VS Code's `parseFloat` surface (decimal optionally
// with sign, fractional part, and scientific notation). Without the
// `[eE][+-]?\d+` tail, `String(1e+21)` would fail to re-decode.
const NUM = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'
// Value literal accepted by `==` / `!=` RHS. VS Code's parser accepts
// `Str | QuotedStr | True | False | In` here; the bare-identifier `Str`
// alternative makes `key1 == key2` parse as `key1 == 'key2'` (RHS is a string)
// — there is no key-vs-key comparison in VS Code's grammar.
const VAL = `'[^']*'|${NUM}|true|false|${KEY}`

const reKey = new RegExp(`^${KEY}$`)
const reEq = new RegExp(`^\\s*(${KEY})\\s*==\\s*(${VAL})\\s*$`)
const reNeq = new RegExp(`^\\s*(${KEY})\\s*!=\\s*(${VAL})\\s*$`)
// VS Code's regex-flag set (scanner.ts `_regexFlags`) is exactly `{i,g,s,m,y,u}`
// — `d` (hasIndices) and `v` (Unicode sets) are NOT recognized. The pattern
// group is `[\s\S]+` (not `.+`) because VS Code's scanner consumes any
// character — newlines included — up to the closing unescaped `/`.
const reMatch = new RegExp(`^\\s*(${KEY})\\s*=~\\s*/([\\s\\S]+)/([gimsuy]*)\\s*$`)
// `in`-clause RHS accepts the same `_value()` surface as `==`: bare identifier
// or quoted string. Quoted strings are uncommon here but VS Code permits them.
const reIn = new RegExp(`^\\s*(${KEY})\\s+in\\s+('[^']*'|${KEY})\\s*$`)
const reCmp = new RegExp(`^\\s*(${KEY})\\s*(<=|>=|<|>)\\s*(${NUM})\\s*$`)

const reNum = new RegExp(`^${NUM}$`)

/**
 * Decode a captured `==`/`!=` RHS lexeme into its value. The RHS surface is
 * `'…'` (quoted string), a numeric literal, `true`/`false`, or a bare
 * identifier. A bare identifier decodes to a *string* — VS Code's `_value()`
 * treats unquoted words as string literals, so `a == b` means `a` equals the
 * string `"b"`. The `reNum` test (not `Number(raw)`) disambiguates numbers
 * from identifiers cleanly: `Number('Infinity')` is finite, but `'Infinity'`
 * is not a numeric *literal*, so it stays a string.
 */
const parseValueLit = (raw: string): string | number | boolean => {
  if (raw.startsWith(`'`)) return raw.slice(1, -1)
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (reNum.test(raw)) return Number(raw)
  return raw
}

/** Encode a value into a `==`/`!=` RHS lexeme. Strings are always quoted. */
const formatValueLit = (v: string | number | boolean): string => {
  if (typeof v === 'string') return `'${v}'`
  return String(v)
}

/** Decode a captured `in`-clause RHS lexeme — bare identifier or `'…'`. */
const parseSetLit = (raw: string): string => (raw.startsWith(`'`) ? raw.slice(1, -1) : raw)

/**
 * Encode an `in`-clause RHS. Emits the bare form when the set name is
 * identifier-shaped (the common case — `resource in fooSet`), quoting only
 * when the name contains characters the bare-identifier grammar rejects.
 */
const formatSetLit = (s: string): string => (reKey.test(s) ? s : `'${s}'`)

/**
 * If `s[i]` opens a *terminated* string (`'…'`) or regex (`/…/`) literal,
 * return the index just past its close; otherwise return `i` unchanged. The
 * paren-matchers below use this to skip literals, so a `(` inside
 * `key == '('` or inside a regex character class doesn't throw off depth
 * counting.
 *
 * VS Code's `'…'` strings have no escape syntax (scanner.ts `_quotedString`);
 * `/…/` regexes escape with `\`. An *unterminated* delimiter returns `i`
 * unchanged — the caller then treats that `'` or `/` as an ordinary
 * character. This matters for round-trip stability: a `WhenUnsafeRaw` whose
 * text holds a lone `'` (e.g. `('foo)`) must not let that quote swallow the
 * trailing `)`, or the outer parens look unbalanced and `WhenNot` re-wrapping
 * accretes a `(…)` layer on every round-trip.
 */
const skipLiteral = (s: string, i: number): number => {
  const open = s.charAt(i)
  if (open === `'`) {
    let j = i + 1
    while (j < s.length && s.charAt(j) !== `'`) j++
    return j < s.length ? j + 1 : i
  }
  if (open === '/') {
    let j = i + 1
    while (j < s.length) {
      const c = s.charAt(j)
      if (c === '\\') j += 2
      else if (c === '/') return j + 1
      else j++
    }
    return i
  }
  return i
}

/**
 * Strip a single layer of balanced outer parens, returning the inner text.
 * Returns `null` when the input is not wrapped by a single matched pair of
 * parens that spans the entire string (e.g. `(a) && (b)` has parens but
 * they don't enclose the whole string). Parens inside string/regex literals
 * are skipped via `skipLiteral`.
 */
const stripOuterParens = (s: string): string | null => {
  const t = s.trim()
  if (!t.startsWith('(') || !t.endsWith(')')) return null
  let depth = 0
  let i = 0
  while (i < t.length) {
    const c = t.charAt(i)
    if (c === `'` || c === '/') {
      const skipped = skipLiteral(t, i)
      if (skipped > i) {
        i = skipped
        continue
      }
      // Unterminated delimiter — fall through, treat as an ordinary char.
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0 && i !== t.length - 1) return null
    }
    i++
  }
  return depth === 0 ? t.slice(1, -1).trim() : null
}

/**
 * Strip the leading `!` (with optional surrounding parens on the inner).
 * Returns `null` when `text` doesn't start with `!`.
 */
const stripNotEnvelope = (s: string): string | null => {
  const t = s.trim()
  if (!t.startsWith('!')) return null
  const inner = t.slice(1).trim()
  return stripOuterParens(inner) ?? inner
}

/**
 * Paren-aware top-level split. Splits `s` on every occurrence of `sep`
 * that sits at paren depth 0. Always returns at least one chunk. String and
 * regex literals are skipped via `skipLiteral`, so a `&&` inside `'a && b'`
 * or a `/…/` is not a split point.
 */
const splitTopLevel = (s: string, sep: '&&' | '||'): ReadonlyArray<string> => {
  const result: string[] = []
  let depth = 0
  let last = 0
  let i = 0
  while (i < s.length) {
    const c = s.charAt(i)
    if (c === `'` || c === '/') {
      const skipped = skipLiteral(s, i)
      if (skipped > i) {
        i = skipped
        continue
      }
      // Unterminated delimiter — fall through, treat as an ordinary char.
    }
    if (c === '(') {
      depth++
      i++
    } else if (c === ')') {
      depth--
      i++
    } else if (depth === 0 && s.startsWith(sep, i)) {
      result.push(s.slice(last, i).trim())
      i += sep.length
      last = i
    } else {
      i++
    }
  }
  result.push(s.slice(last).trim())
  return result
}

const failType = (schema: Schema.Schema.Any, actual: unknown, message: string) =>
  ParseResult.fail(new ParseResult.Type(schema.ast, actual, message))

// ─── TaggedClasses (the structural AST) ──────────────────────────────────

export class WhenBoolKey extends Schema.TaggedClass<WhenBoolKey>()('WhenBoolKey', {
  key: Schema.NonEmptyTrimmedString,
}) {}

export class WhenEq extends Schema.TaggedClass<WhenEq>()('WhenEq', {
  key: Schema.NonEmptyTrimmedString,
  value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
}) {}

export class WhenNeq extends Schema.TaggedClass<WhenNeq>()('WhenNeq', {
  key: Schema.NonEmptyTrimmedString,
  value: Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
}) {}

/**
 * Regex flag string for `WhenMatch`. VS Code's scanner accepts exactly the
 * flag set `{i,g,s,m,y,u}`; an empty flag string is the *absence* of flags
 * (the field is omitted), never `''`. Constraining the field here keeps the
 * AST from holding a flag value the codec can't faithfully serialize.
 */
const WhenMatchFlags = Schema.String.pipe(Schema.pattern(/^[gimsuy]+$/))

export class WhenMatch extends Schema.TaggedClass<WhenMatch>()('WhenMatch', {
  key: Schema.NonEmptyTrimmedString,
  pattern: Schema.NonEmptyTrimmedString,
  flags: Schema.optional(WhenMatchFlags),
}) {}

export class WhenIn extends Schema.TaggedClass<WhenIn>()('WhenIn', {
  key: Schema.NonEmptyTrimmedString,
  set: Schema.NonEmptyTrimmedString,
}) {}

export class WhenCmp extends Schema.TaggedClass<WhenCmp>()('WhenCmp', {
  key: Schema.NonEmptyTrimmedString,
  op: Schema.Literal('<', '<=', '>', '>='),
  value: Schema.Number,
}) {}

export class WhenNot extends Schema.TaggedClass<WhenNot>()('WhenNot', {
  inner: Schema.suspend((): Schema.Schema<WhenAst> => WhenAstStruct),
}) {}

// `&&` and `||` are binary-or-wider — a meaningful conjunction/disjunction
// has ≥ 2 terms. The codec only round-trips that case; a 0- or 1-term node
// has no canonical string (an empty join produces `''`, which fails to
// decode). The `When` builder's `and`/`or` enforce ≥ 2 at the typed
// authoring boundary. A schema-level `minItems(2)` would be the stricter
// guarantee, but it cannot be applied here: a filter on this recursive
// `terms` field breaks `transformOrFail`'s encode for combinators nested
// inside another combinator (the encode side re-validates the encoded
// struct, and the filter rejects it mid-transform). So the ≥ 2 invariant
// lives in the builder, not the schema.
export class WhenAnd extends Schema.TaggedClass<WhenAnd>()('WhenAnd', {
  terms: Schema.Array(Schema.suspend((): Schema.Schema<WhenAst> => WhenAstStruct)),
}) {}

export class WhenOr extends Schema.TaggedClass<WhenOr>()('WhenOr', {
  terms: Schema.Array(Schema.suspend((): Schema.Schema<WhenAst> => WhenAstStruct)),
}) {}

export class WhenUnsafeRaw extends Schema.TaggedClass<WhenUnsafeRaw>()('WhenUnsafeRaw', {
  text: Schema.NonEmptyTrimmedString,
}) {}

/**
 * Structural union over the AST TaggedClasses. Encoded form is the
 * tagged-struct shape; useful for JSON serialization, pattern-matching
 * without strings, or storing the AST inside another schema.
 */
export const WhenAstStruct: Schema.Schema<WhenAst> = Schema.Union(
  WhenBoolKey,
  WhenEq,
  WhenNeq,
  WhenMatch,
  WhenIn,
  WhenCmp,
  WhenNot,
  WhenAnd,
  WhenOr,
  WhenUnsafeRaw,
)

// ─── Per-variant string codecs ───────────────────────────────────────────

// Within these decode closures, every regex used has its capture groups
// declared as required (no `?` quantifier on a group), so when `exec()`
// returns non-null, every group index is guaranteed to be a string. The
// `!` and the `as` cast below are sound under that invariant; oxlint
// disables are scoped to each line that depends on it.

const WhenBoolKeyClause = Schema.transformOrFail(Schema.String, WhenBoolKey, {
  strict: true,
  decode: (text) => {
    const m = reKey.exec(text.trim())
    if (m === null) {
      return failType(WhenBoolKey, text, `not a bare identifier: ${text}`)
    }
    return ParseResult.succeed(WhenBoolKey.make({ key: m[0] }))
  },
  encode: ({ key }) => ParseResult.succeed(key),
})

const WhenEqClause = Schema.transformOrFail(Schema.String, WhenEq, {
  strict: true,
  decode: (text) => {
    const m = reEq.exec(text)
    if (m === null) {
      return failType(WhenEq, text, `not an == expression: ${text}`)
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- reEq has 2 required capture groups
    return ParseResult.succeed(WhenEq.make({ key: m[1]!, value: parseValueLit(m[2]!) }))
  },
  encode: ({ key, value }) => ParseResult.succeed(`${key} == ${formatValueLit(value)}`),
})

const WhenNeqClause = Schema.transformOrFail(Schema.String, WhenNeq, {
  strict: true,
  decode: (text) => {
    const m = reNeq.exec(text)
    if (m === null) {
      return failType(WhenNeq, text, `not a != expression: ${text}`)
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- reNeq has 2 required capture groups
    return ParseResult.succeed(WhenNeq.make({ key: m[1]!, value: parseValueLit(m[2]!) }))
  },
  encode: ({ key, value }) => ParseResult.succeed(`${key} != ${formatValueLit(value)}`),
})

const WhenMatchClause = Schema.transformOrFail(Schema.String, WhenMatch, {
  strict: true,
  decode: (text) => {
    const m = reMatch.exec(text)
    if (m === null) {
      return failType(WhenMatch, text, `not a =~ expression: ${text}`)
    }
    // The flags group `[gimsuy]*` always matches (possibly empty), so m[3] is
    // always a string. The first two groups are required by the regex.
    // oxlint-disable-next-line typescript/no-non-null-assertion -- reMatch has 3 required capture groups
    const flags = m[3]!
    return ParseResult.succeed(
      WhenMatch.make({
        // oxlint-disable-next-line typescript/no-non-null-assertion -- reMatch has 3 required capture groups
        key: m[1]!,
        // oxlint-disable-next-line typescript/no-non-null-assertion -- reMatch has 3 required capture groups
        pattern: m[2]!,
        ...(flags.length > 0 ? { flags } : {}),
      }),
    )
  },
  encode: ({ key, pattern, flags }) => ParseResult.succeed(`${key} =~ /${pattern}/${flags ?? ''}`),
})

const WhenInClause = Schema.transformOrFail(Schema.String, WhenIn, {
  strict: true,
  decode: (text) => {
    const m = reIn.exec(text)
    if (m === null) {
      return failType(WhenIn, text, `not an 'in' expression: ${text}`)
    }
    // oxlint-disable-next-line typescript/no-non-null-assertion -- reIn has 2 required capture groups
    return ParseResult.succeed(WhenIn.make({ key: m[1]!, set: parseSetLit(m[2]!) }))
  },
  encode: ({ key, set }) => ParseResult.succeed(`${key} in ${formatSetLit(set)}`),
})

const WhenCmpClause = Schema.transformOrFail(Schema.String, WhenCmp, {
  strict: true,
  decode: (text) => {
    const m = reCmp.exec(text)
    if (m === null) {
      return failType(WhenCmp, text, `not a comparison expression: ${text}`)
    }
    return ParseResult.succeed(
      WhenCmp.make({
        // oxlint-disable-next-line typescript/no-non-null-assertion -- reCmp has 3 required capture groups
        key: m[1]!,
        // oxlint-disable-next-line typescript/no-non-null-assertion typescript/no-unsafe-type-assertion -- reCmp's second group is `(<=|>=|<|>)` — the four literal operators
        op: m[2]! as '<' | '<=' | '>' | '>=',
        // oxlint-disable-next-line typescript/no-non-null-assertion -- reCmp has 3 required capture groups
        value: Number(m[3]!),
      }),
    )
  },
  encode: ({ key, op, value }) => ParseResult.succeed(`${key} ${op} ${value}`),
})

const WhenNotClause: Schema.Schema<WhenNot, string> = Schema.transformOrFail(
  Schema.String,
  WhenNot,
  {
    strict: true,
    decode: (text) => {
      const stripped = stripNotEnvelope(text)
      if (stripped === null) return failType(WhenNot, text, `not a ! expression: ${text}`)
      return pipe(
        ParseResult.decodeUnknown(WhenClause)(stripped),
        Effect.map((inner) => WhenNot.make({ inner })),
      )
    },
    encode: ({ inner }) =>
      pipe(
        ParseResult.encode(WhenClause)(inner),
        Effect.map((s) => `!(${s})`),
      ),
  },
)

const WhenAndClause: Schema.Schema<WhenAnd, string> = Schema.transformOrFail(
  Schema.String,
  WhenAnd,
  {
    strict: true,
    decode: (text) => {
      const parts = splitTopLevel(text.trim(), '&&')
      if (parts.length < 2) return failType(WhenAnd, text, `not an && expression: ${text}`)
      return pipe(
        Effect.forEach(parts, (p) =>
          ParseResult.decodeUnknown(WhenClause)(stripOuterParens(p) ?? p),
        ),
        Effect.map((terms) => WhenAnd.make({ terms })),
      )
    },
    encode: ({ terms }) =>
      pipe(
        Effect.forEach(terms, (t) => ParseResult.encode(WhenClause)(t)),
        Effect.map((parts) => parts.map((p) => `(${p})`).join(' && ')),
      ),
  },
)

const WhenOrClause: Schema.Schema<WhenOr, string> = Schema.transformOrFail(Schema.String, WhenOr, {
  strict: true,
  decode: (text) => {
    const parts = splitTopLevel(text.trim(), '||')
    if (parts.length < 2) return failType(WhenOr, text, `not an || expression: ${text}`)
    return pipe(
      Effect.forEach(parts, (p) => ParseResult.decodeUnknown(WhenClause)(stripOuterParens(p) ?? p)),
      Effect.map((terms) => WhenOr.make({ terms })),
    )
  },
  encode: ({ terms }) =>
    pipe(
      Effect.forEach(terms, (t) => ParseResult.encode(WhenClause)(t)),
      Effect.map((parts) => parts.map((p) => `(${p})`).join(' || ')),
    ),
})

const WhenUnsafeRawClause = Schema.transformOrFail(Schema.String, WhenUnsafeRaw, {
  strict: true,
  decode: (text) => {
    const t = text.trim()
    return t.length === 0
      ? failType(WhenUnsafeRaw, text, `empty when-clause`)
      : ParseResult.succeed(WhenUnsafeRaw.make({ text: t }))
  },
  encode: ({ text }) => ParseResult.succeed(text),
})

/**
 * Bidirectional codec between a `WhenAst` and VS Code's canonical
 * when-clause string. Branch ordering inside the union is significant:
 * the precedence-binding combinators (`||` before `&&`, then `!`) are
 * tried first so paren-aware top-level splits discriminate before any
 * atom matches. `WhenUnsafeRaw` is the catch-all fallback.
 *
 * **This codec is a normalizer, not an identity round-trip.** `decode` is
 * many-to-one: several distinct strings collapse to the same AST, and
 * `encode` always emits one canonical form. Specifically —
 *
 * - **Redundant parens are dropped.** `(a)` decodes to `WhenBoolKey('a')`;
 *   re-encoding emits `a`. Combinators always re-emit their own minimal
 *   parens (`(t1) && (t2)`).
 * - **Bare-word RHS becomes quoted.** `a == b` decodes to
 *   `WhenEq('a', 'b')` — VS Code treats an unquoted RHS word as a string —
 *   and re-encodes as `a == 'b'`.
 * - **Whitespace is normalized** to the canonical single-space form.
 *
 * So `decode(encode(decode(s)))` equals `decode(s)`: the first round-trip
 * canonicalizes, every subsequent one is a fixpoint. The property tests in
 * `tests/property.test.ts` enforce this.
 *
 * @example
 * ```ts
 * const ast = Schema.decodeUnknownSync(WhenClause)(
 *   "activeCustomEditorId == 'vscode.markdown.preview.editor' && !inputFocus",
 * )
 *
 * const text: string = Schema.encodeSync(WhenClause)(ast)
 * ```
 */
export const WhenClause: Schema.Schema<WhenAst, string> = Schema.Union(
  WhenOrClause,
  WhenAndClause,
  WhenNotClause,
  WhenEqClause,
  WhenNeqClause,
  WhenMatchClause,
  WhenInClause,
  WhenCmpClause,
  WhenBoolKeyClause,
  WhenUnsafeRawClause,
)
