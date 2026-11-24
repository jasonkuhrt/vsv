import {
  Array,
  Option,
  String,
  Effect,
  pipe,
  Schema,
  SchemaGetter,
  SchemaIssue,
  SchemaParser,
} from 'effect';
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
//     `Schema.decodeTo` whose decoded side is the variant's
//     TaggedClass. Encoded form is `string` (VS Code's clause syntax),
//     decoded form is `WhenAst`. Public API:
//
//       Schema.encodeEffect(WhenClause)(ast)              // AST -> string
//       Schema.decodeUnknownEffect(WhenClause)(text)      // string -> AST
//
// There is no exported `serialize` or `parse` function. The schema IS
// the codec — per-variant `decode`/`encode` are the bidirectional spec,
// and combinators recurse via `Schema.encodeEffect(WhenClause)` /
// `Schema.decodeUnknownEffect(WhenClause)` on their children.
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';

// Independent recursive shapes break the value-level cycle in Schema.suspend.
interface NotNode {
  readonly _tag: 'WhenNot';
  readonly inner: WhenAst;
}
interface AndNode {
  readonly _tag: 'WhenAnd';
  readonly terms: ReadonlyArray<WhenAst>;
}
interface OrNode {
  readonly _tag: 'WhenOr';
  readonly terms: ReadonlyArray<WhenAst>;
}

export type WhenAst =
  | WhenBoolKey
  | WhenEq
  | WhenNeq
  | WhenMatch
  | WhenIn
  | WhenCmp
  | NotNode
  | AndNode
  | OrNode
  | WhenUnsafeRaw;

// ─── Internal helpers (private to the module) ────────────────────────────

// Identifier (context-key name). VS Code's actual identifier surface
// (scanner.ts `_string`) is a wide charset including hyphens, dots, `<>/\:`
// etc. We accept the common subset that real-world extensions use; anything
// outside falls through to WhenUnsafeRaw. The hyphen extends what 1b59ffb
// shipped — `auxiliary-bar-visible`-style keys are widespread in VS Code core.
const KEY = '[A-Za-z_][\\w.-]*';
// Numeric literal — matches VS Code's `parseFloat` surface (decimal optionally
// with sign, fractional part, and scientific notation). Without the
// `[eE][+-]?\d+` tail, `globalThis.String(1e+21)` would fail to re-decode.
const NUM = '-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?';
// Value literal accepted by `==` / `!=` RHS. VS Code's parser accepts
// `Str | QuotedStr | True | False | In` here; the bare-identifier `Str`
// alternative makes `key1 == key2` parse as `key1 == 'key2'` (RHS is a string)
// — there is no key-vs-key comparison in VS Code's grammar.
const VAL = `'[^']*'|${NUM}|true|false|${KEY}`;

const reKey = new RegExp(`^${KEY}$`);
const reEq = new RegExp(`^\\s*(${KEY})\\s*==\\s*(${VAL})\\s*$`);
const reNeq = new RegExp(`^\\s*(${KEY})\\s*!=\\s*(${VAL})\\s*$`);
// VS Code's regex-flag set (scanner.ts `_regexFlags`) is exactly `{i,g,s,m,y,u}`
// — `d` (hasIndices) and `v` (Unicode sets) are NOT recognized. The pattern
// group is `[\s\S]+` (not `.+`) because VS Code's scanner consumes any
// character — newlines included — up to the closing unescaped `/`.
const reMatch = new RegExp(
  `^\\s*(${KEY})\\s*=~\\s*/([\\s\\S]+)/([gimsuy]*)\\s*$`,
);
// `in`-clause RHS accepts the same `_value()` surface as `==`: bare identifier
// or quoted string. Quoted strings are uncommon here but VS Code permits them.
const reIn = new RegExp(`^\\s*(${KEY})\\s+in\\s+('[^']*'|${KEY})\\s*$`);
const reCmp = new RegExp(`^\\s*(${KEY})\\s*(<=|>=|<|>)\\s*(${NUM})\\s*$`);

const reNum = new RegExp(`^${NUM}$`);

/**
 * @description Decode a captured `==`/`!=` RHS lexeme into its value. The RHS
 * surface is `'…'` (quoted string), a numeric literal, `true`/`false`, or a
 * bare identifier. A bare identifier decodes to a _string_ — VS Code's
 * `_value()` treats unquoted words as string literals, so `a == b` means `a`
 * equals the string `"b"`. The `reNum` test (not `Number(raw)`) disambiguates
 * numbers from identifiers cleanly: `Number('Infinity')` is finite, but
 * `'Infinity'` is not a numeric _literal_, so it stays a string.
 */
const parseValueLit = (raw: string): string | number | boolean => {
  if (String.startsWith(`'`)(raw)) return String.slice(1, -1)(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (reNum.test(raw)) return Number(raw);
  return raw;
};

/**
 * @description Encode a value into a `==`/`!=` RHS lexeme. Strings are always
 * quoted.
 */
const formatValueLit = (v: string | number | boolean): string => {
  if (typeof v === 'string') return `'${v}'`;
  return globalThis.String(v);
};

/**
 * @description Decode a captured `in`-clause RHS lexeme — bare identifier or
 * `'…'`.
 */
const parseSetLit = (raw: string): string =>
  String.startsWith(`'`)(raw) ? String.slice(1, -1)(raw) : raw;

/**
 * @description Encode an `in`-clause RHS. Emits the bare form when the set name
 * is identifier-shaped (the common case — `resource in fooSet`), quoting only
 * when the name contains characters the bare-identifier grammar rejects.
 */
const formatSetLit = (s: string): string => (reKey.test(s) ? s : `'${s}'`);

/**
 * @description If `s[i]` opens a _terminated_ string (`'…'`) or regex (`/…/`)
 * literal, return the index just past its close; otherwise return `i`
 * unchanged. The paren-matchers below use this to skip literals, so a `(`
 * inside `key == '('` or inside a regex character class doesn't throw off depth
 * counting.
 *
 * VS Code's `'…'` strings have no escape syntax (scanner.ts `_quotedString`);
 * `/…/` regexes escape with `\`. An _unterminated_ delimiter returns `i`
 * unchanged — the caller then treats that `'` or `/` as an ordinary character.
 * This matters for round-trip stability: a `WhenUnsafeRaw` whose text holds a
 * lone `'` (e.g. `('foo)`) must not let that quote swallow the trailing `)`, or
 * the outer parens look unbalanced and `WhenNot` re-wrapping accretes a `(…)`
 * layer on every round-trip.
 */
const skipLiteral = (s: string, i: number): number => {
  const open = Option.getOrUndefined(String.charAt(s, i));
  if (open === `'`) {
    let j = i + 1;
    while (j < s.length && Option.getOrUndefined(String.charAt(s, j)) !== `'`)
      j++;
    return j < s.length ? j + 1 : i;
  }
  if (open === '/') {
    let j = i + 1;
    while (j < s.length) {
      const c = Option.getOrUndefined(String.charAt(s, j));
      if (c === '\\') j += 2;
      else if (c === '/') return j + 1;
      else j++;
    }
    return i;
  }
  return i;
};

/**
 * @description Strip a single layer of balanced outer parens, returning the
 * inner text. Returns `null` when the input is not wrapped by a single matched
 * pair of parens that spans the entire string (e.g. `(a) && (b)` has parens but
 * they don't enclose the whole string). Parens inside string/regex literals are
 * skipped via `skipLiteral`.
 */
const stripOuterParens = (s: string): string | null => {
  const t = String.trim(s);
  if (!String.startsWith('(')(t) || !String.endsWith(')')(t)) return null;
  let depth = 0;
  let i = 0;
  while (i < t.length) {
    const c = Option.getOrUndefined(String.charAt(t, i));
    if (c === `'` || c === '/') {
      const skipped = skipLiteral(t, i);
      if (skipped > i) {
        i = skipped;
        continue;
      }
      // Unterminated delimiter — fall through, treat as an ordinary char.
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0 && i !== t.length - 1) return null;
    }
    i++;
  }
  return depth === 0 ? String.trim(String.slice(1, -1)(t)) : null;
};

/**
 * @description Strip the leading `!` (with optional surrounding parens on the
 * inner). Returns `null` when `text` doesn't start with `!`.
 */
const stripNotEnvelope = (s: string): string | null => {
  const t = String.trim(s);
  if (!String.startsWith('!')(t)) return null;
  const inner = String.trim(String.slice(1)(t));
  return stripOuterParens(inner) ?? inner;
};

/**
 * @description Paren-aware top-level split. Splits `s` on every occurrence of
 * `sep` that sits at paren depth 0. Always returns at least one chunk. String
 * and regex literals are skipped via `skipLiteral`, so a `&&` inside `'a && b'`
 * or a `/…/` is not a split point.
 */
const splitTopLevel = (s: string, sep: '&&' | '||'): ReadonlyArray<string> => {
  const result: string[] = [];
  let depth = 0;
  let last = 0;
  let i = 0;
  while (i < s.length) {
    const c = Option.getOrUndefined(String.charAt(s, i));
    if (c === `'` || c === '/') {
      const skipped = skipLiteral(s, i);
      if (skipped > i) {
        i = skipped;
        continue;
      }
      // Unterminated delimiter — fall through, treat as an ordinary char.
    }
    if (c === '(') {
      depth++;
      i++;
    } else if (c === ')') {
      depth--;
      i++;
    } else if (depth === 0 && String.startsWith(sep, i)(s)) {
      result.push(String.trim(String.slice(last, i)(s)));
      i += sep.length;
      last = i;
    } else {
      i++;
    }
  }
  result.push(String.trim(String.slice(last)(s)));
  return result;
};

const invalidClause = (text: string, message: string) =>
  Effect.fail(new SchemaIssue.InvalidValue({ message }, text));

// ─── Encode-side parenthesization (minimal, precedence-aware) ─────────────

// VS Code's when-grammar precedence, loosest → tightest:
//   `||`  <  `&&`  <  `!`  <  atoms / `(…)`
// (parser methods `_or` → `_and` → `_term` → `_primary` in VS Code's
// `contextkey.ts`). The encoder emits the MINIMAL parenthesization that still
// round-trips: a combinator child is wrapped ONLY when rendering it bare would
// let the parent's parser re-associate it — i.e. when the child binds looser
// than, or equally-and-associatively into, the parent context. This is the
// canonical idiomatic form VS Code itself writes (its runtime serializers emit
// `a && b` / `a || b` with no per-term parens, and `!key` with no parens).
//
// vsv, unlike VS Code's runtime, does NOT distribute `&&` over `||` into DNF
// (contextkey.ts:1714 "We must distribute any OR expression because we don't
// support parens"). vsv keeps the nested tree, so it DOES need parens to fence
// an `Or` term sitting under an `And` (and to fence same-operator nesting that
// would otherwise flatten on re-parse) — that's the only reason any paren is
// emitted.

const PREC_OR = 0;
const PREC_AND = 1;
const PREC_TIGHT = 2; // atoms, `!`, and the catch-all raw escape hatch

/**
 * @description The when-grammar precedence level a node binds at.
 */
const precedenceOf = (ast: WhenAst): number => {
  if (ast._tag === 'WhenOr') return PREC_OR;
  if (ast._tag === 'WhenAnd') return PREC_AND;
  return PREC_TIGHT;
};

/**
 * @description Wrap an already-encoded combinator child in parens iff leaving
 * it bare would change the decoded structure. `parentPrec` is the parent
 * combinator's own precedence; a child is fenced when it binds looser than the
 * parent, or when it is the _same_ associative operator (bare nesting would
 * flatten on re-parse), or when it is a `WhenUnsafeRaw` (its arbitrary text may
 * carry top-level `&&`/`||`/`!` the parent split would absorb).
 */
const wrapChild = (
  parentPrec: number,
  child: WhenAst,
  encoded: string,
): string => {
  if (child._tag === 'WhenUnsafeRaw') return `(${encoded})`;
  return precedenceOf(child) <= parentPrec ? `(${encoded})` : encoded;
};

// ─── TaggedClasses (the structural AST) ──────────────────────────────────

export class WhenBoolKey extends Schema.TaggedClass<WhenBoolKey, {}>()(
  'WhenBoolKey',
  {
    key: NonEmptyTrimmedString,
  },
) {}

export class WhenEq extends Schema.TaggedClass<WhenEq, {}>()('WhenEq', {
  key: NonEmptyTrimmedString,
  value: Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
}) {}

export class WhenNeq extends Schema.TaggedClass<WhenNeq, {}>()('WhenNeq', {
  key: NonEmptyTrimmedString,
  value: Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]),
}) {}

/**
 * @description Regex flag string for `WhenMatch`. VS Code's scanner accepts
 * exactly the flag set `{i,g,s,m,y,u}`; an empty flag string is the _absence_
 * of flags (the field is omitted), never `''`. Constraining the field here
 * keeps the AST from holding a flag value the codec can't faithfully
 * serialize.
 */
const WhenMatchFlags = Schema.String.check(Schema.isPattern(/^[gimsuy]+$/));

export class WhenMatch extends Schema.TaggedClass<WhenMatch, {}>()(
  'WhenMatch',
  {
    key: NonEmptyTrimmedString,
    pattern: NonEmptyTrimmedString,
    flags: Schema.optional(WhenMatchFlags),
  },
) {}

export class WhenIn extends Schema.TaggedClass<WhenIn, {}>()('WhenIn', {
  key: NonEmptyTrimmedString,
  set: NonEmptyTrimmedString,
}) {}

export class WhenCmp extends Schema.TaggedClass<WhenCmp, {}>()('WhenCmp', {
  key: NonEmptyTrimmedString,
  op: Schema.Literals(['<', '<=', '>', '>=']),
  value: Schema.Finite,
}) {}

export class WhenNot extends Schema.TaggedClass<WhenNot, {}>()('WhenNot', {
  inner: Schema.suspend((): Schema.Codec<WhenAst> => WhenAstStruct),
}) {}

// `&&` and `||` are binary-or-wider — a meaningful conjunction/disjunction
// has ≥ 2 terms. The codec only round-trips that case; a 0- or 1-term node
// has no canonical string (an empty join produces `''`, which fails to
// decode). The `When` builder's `and`/`or` enforce ≥ 2 at the typed
// authoring boundary. The structural schema stores the author's terms.
export class WhenAnd extends Schema.TaggedClass<WhenAnd, {}>()('WhenAnd', {
  terms: Schema.Array(
    Schema.suspend((): Schema.Codec<WhenAst> => WhenAstStruct),
  ),
}) {}

export class WhenOr extends Schema.TaggedClass<WhenOr, {}>()('WhenOr', {
  terms: Schema.Array(
    Schema.suspend((): Schema.Codec<WhenAst> => WhenAstStruct),
  ),
}) {}

export class WhenUnsafeRaw extends Schema.TaggedClass<WhenUnsafeRaw, {}>()(
  'WhenUnsafeRaw',
  {
    text: NonEmptyTrimmedString,
  },
) {}

/**
 * @description Structural union over the AST TaggedClasses. Encoded form is the
 * tagged-struct shape; useful for JSON serialization, pattern-matching without
 * strings, or storing the AST inside another schema.
 */
export const WhenAstStruct: Schema.Codec<WhenAst> = Schema.Union([
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
]);

// ─── Per-variant string codecs ───────────────────────────────────────────

const WhenBoolKeyClause = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenBoolKey), {
    decode: SchemaGetter.transformEffect((text) => {
      const match = reKey.exec(String.trim(text));
      return match === null
        ? invalidClause(text, `not a bare identifier: ${text}`)
        : WhenBoolKey.makeEffect({ key: match[0] });
    }),
    encode: SchemaGetter.transform(({ key }) => key),
  }),
);

const WhenEqClause = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenEq), {
    decode: SchemaGetter.transformEffect((text) => {
      const [, key, rhs] = reEq.exec(text) ?? [];
      return key === undefined || rhs === undefined
        ? invalidClause(text, `not an == expression: ${text}`)
        : WhenEq.makeEffect({ key, value: parseValueLit(rhs) });
    }),
    encode: SchemaGetter.transform(
      ({ key, value }) => `${key} == ${formatValueLit(value)}`,
    ),
  }),
);

const WhenNeqClause = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenNeq), {
    decode: SchemaGetter.transformEffect((text) => {
      const [, key, rhs] = reNeq.exec(text) ?? [];
      return key === undefined || rhs === undefined
        ? invalidClause(text, `not a != expression: ${text}`)
        : WhenNeq.makeEffect({ key, value: parseValueLit(rhs) });
    }),
    encode: SchemaGetter.transform(
      ({ key, value }) => `${key} != ${formatValueLit(value)}`,
    ),
  }),
);

const WhenMatchClause = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenMatch), {
    decode: SchemaGetter.transformEffect((text) => {
      const [, key, pattern, flags] = reMatch.exec(text) ?? [];
      return key === undefined || pattern === undefined || flags === undefined
        ? invalidClause(text, `not a =~ expression: ${text}`)
        : WhenMatch.makeEffect({
            key,
            pattern,
            ...(flags === '' ? {} : { flags }),
          });
    }),
    encode: SchemaGetter.transform(
      ({ key, pattern, flags }) => `${key} =~ /${pattern}/${flags ?? ''}`,
    ),
  }),
);

const WhenInClause = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenIn), {
    decode: SchemaGetter.transformEffect((text) => {
      const [, key, rhs] = reIn.exec(text) ?? [];
      return key === undefined || rhs === undefined
        ? invalidClause(text, `not an 'in' expression: ${text}`)
        : WhenIn.makeEffect({ key, set: parseSetLit(rhs) });
    }),
    encode: SchemaGetter.transform(
      ({ key, set }) => `${key} in ${formatSetLit(set)}`,
    ),
  }),
);

const isComparisonOperator = Schema.is(WhenCmp.fields.op);

const WhenCmpClause = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenCmp), {
    decode: SchemaGetter.transformEffect((text) => {
      const [, key, op, rhs] = reCmp.exec(text) ?? [];
      return key === undefined || rhs === undefined || !isComparisonOperator(op)
        ? invalidClause(text, `not a comparison expression: ${text}`)
        : WhenCmp.makeEffect({ key, op, value: Number(rhs) });
    }),
    encode: SchemaGetter.transform(
      ({ key, op, value }) => `${key} ${op} ${globalThis.String(value)}`,
    ),
  }),
);

const WhenNotClause: Schema.Codec<WhenNot, string> = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenNot), {
    decode: SchemaGetter.transformEffect((text) => {
      const stripped = stripNotEnvelope(text);
      if (stripped === null)
        return invalidClause(text, `not a ! expression: ${text}`);
      return pipe(
        SchemaParser.decodeEffect(WhenClause)(stripped),
        Effect.map((inner) => WhenNot.make({ inner })),
      );
    }),
    encode: SchemaGetter.transformEffect(({ inner }) =>
      pipe(
        SchemaParser.encodeEffect(WhenClause)(inner),
        // `!` binds tightest. VS Code emits `!key` (no parens) when negating a
        // bare key — its own `ContextKeyNotExpr.serialize()` is `!${key}`
        // (contextkey.ts:1163) — and `!(expr)` for any compound. The bare form
        // is sound only for `WhenBoolKey`: VS Code's `_term` lets `!` grab a
        // KEY directly but nothing else, so `!a == b` would parse as
        // `(!a) == b`, not `!(a == b)`. Everything else gets the paren envelope.
        Effect.map((s) => (inner._tag === 'WhenBoolKey' ? `!${s}` : `!(${s})`)),
      ),
    ),
  }),
);

const WhenAndClause: Schema.Codec<WhenAnd, string> = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenAnd), {
    decode: SchemaGetter.transformEffect((text) => {
      const parts = splitTopLevel(String.trim(text), '&&');
      if (parts.length < 2)
        return invalidClause(text, `not an && expression: ${text}`);
      return pipe(
        Effect.forEach(parts, (p) =>
          SchemaParser.decodeEffect(WhenClause)(stripOuterParens(p) ?? p),
        ),
        Effect.map((terms) => WhenAnd.make({ terms })),
      );
    }),
    encode: SchemaGetter.transformEffect(({ terms }) =>
      pipe(
        // Minimal parens: fence only `Or` terms (looser) and nested `And`
        // terms (same operator — bare nesting would flatten on re-parse).
        // Atoms, `!`-negations, and `UnsafeRaw` are handled by `wrapChild`.
        Effect.forEach(terms, (t) =>
          pipe(
            SchemaParser.encodeEffect(WhenClause)(t),
            Effect.map((s) => wrapChild(PREC_AND, t, s)),
          ),
        ),
        Effect.map((parts) => Array.join(parts, ' && ')),
      ),
    ),
  }),
);

const WhenOrClause: Schema.Codec<WhenOr, string> = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenOr), {
    decode: SchemaGetter.transformEffect((text) => {
      const parts = splitTopLevel(String.trim(text), '||');
      if (parts.length < 2)
        return invalidClause(text, `not an || expression: ${text}`);
      return pipe(
        Effect.forEach(parts, (p) =>
          SchemaParser.decodeEffect(WhenClause)(stripOuterParens(p) ?? p),
        ),
        Effect.map((terms) => WhenOr.make({ terms })),
      );
    }),
    encode: SchemaGetter.transformEffect(({ terms }) =>
      pipe(
        // Minimal parens: `&&`, `!`, and atoms all bind tighter than `||`, so
        // they render bare. Only a nested `Or` term (same operator) is fenced,
        // to keep it from flattening into the parent on re-parse.
        Effect.forEach(terms, (t) =>
          pipe(
            SchemaParser.encodeEffect(WhenClause)(t),
            Effect.map((s) => wrapChild(PREC_OR, t, s)),
          ),
        ),
        Effect.map((parts) => Array.join(parts, ' || ')),
      ),
    ),
  }),
);

const WhenUnsafeRawClause = Schema.String.pipe(
  Schema.decodeTo(Schema.toType(WhenUnsafeRaw), {
    decode: SchemaGetter.transformEffect((text) => {
      const t = String.trim(text);
      return t.length === 0
        ? invalidClause(text, `empty when-clause`)
        : Effect.succeed(WhenUnsafeRaw.make({ text: t }));
    }),
    encode: SchemaGetter.transformEffect(({ text }) => Effect.succeed(text)),
  }),
);

/**
 * @description Bidirectional codec between a `WhenAst` and VS Code's canonical
 * when-clause string. Branch ordering inside the union is significant: the
 * precedence-binding combinators (`||` before `&&`, then `!`) are tried first
 * so paren-aware top-level splits discriminate before any atom matches.
 * `WhenUnsafeRaw` is the catch-all fallback.
 *
 * **This codec is a normalizer, not an identity round-trip.** `decode` is
 * many-to-one: several distinct strings collapse to the same AST, and `encode`
 * always emits one canonical form — the MINIMAL, precedence-aware
 * parenthesization VS Code itself writes (`||` < `&&` < `!` < atoms).
 * Specifically —
 *
 * - **Parens are minimal.** A combinator child is fenced only when leaving it
 *   bare would let the parent re-associate it: an `Or` under an `And` (`a && (b
 *   || c)`), or same-operator nesting that would flatten (`a && (b && c)`).
 *   Atoms and bare-key negations render without parens (`a && b`,
 *   `!inputFocus`). Redundant parens in the INPUT are dropped: `(a)` decodes to
 *   `WhenBoolKey('a')`, re-encoding emits `a`.
 * - **Bare-word RHS becomes quoted.** `a == b` decodes to `WhenEq('a', 'b')` — VS
 *   Code treats an unquoted RHS word as a string — and re-encodes as `a ==
 *   'b'`.
 * - **Whitespace is normalized** to the canonical single-space form.
 *
 * So `decode(encode(decode(s)))` equals `decode(s)`: the first round-trip
 * canonicalizes, every subsequent one is a fixpoint, and `encode` is stable
 * (`encode(decode(encode(ast)))` byte-equals `encode(ast)`). A clause already
 * in the minimal idiomatic form (everything VS Code/humans write in
 * `keybindings.json`) survives `decode → encode` byte-for-byte. The property
 * tests in `tests/property.test.ts` and the live corpus in
 * `tests/acceptance-live.test.ts` enforce this.
 *
 * @example
 *   ```ts
 *   const ast = Schema.decodeUnknownEffect(WhenClause)(
 *     "activeCustomEditorId == 'vscode.markdown.preview.editor' && !inputFocus",
 *   );
 *
 *   const text: string = Schema.encodeEffect(WhenClause)(ast);
 *   ```;
 */
export const WhenClause: Schema.Codec<WhenAst, string> = Schema.Union([
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
]);
