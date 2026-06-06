# vsv/when — typed when-clause authoring

vsv models VS Code's `when`-clause expression language as a discriminated
union of Effect `Schema.TaggedClass` variants plus a bidirectional codec.
Extensions author clauses against a manifest-typed builder; vsv produces
the canonical clause string only at the serialization boundary.

```ts
import { defineManifest, ContextKeyDecl, ExternalContextKeyDecl } from '@jasonkuhrt/vsv/manifest'
import { When, WhenClause } from '@jasonkuhrt/vsv/when'
import { Schema } from 'effect'

const manifest = defineManifest({
  name: 'ext',
  publisher: 'jasonkuhrt',
  contextKeys: [ContextKeyDecl({ name: 'ext.ready', valueType: Schema.Boolean })],
  externalContextKeys: [
    ExternalContextKeyDecl({
      name: 'activeCustomEditorId',
      valueType: Schema.Literal('vscode.markdown.preview.editor'),
    }),
  ],
})

const $ = When(manifest)
const ast = $.and(
  $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor'),
  $.not($.is('ext.ready')),
)

const clause: string = Schema.encodeSync(WhenClause)(ast)
// → "activeCustomEditorId == 'vscode.markdown.preview.editor' && !ext.ready"
```

## Two layers

### `WhenAstStruct` — structural schema

Pure Effect Schema union over the AST variants. Encoded form is the
tagged-struct shape; useful when you want to manipulate, JSON-serialize,
or pattern-match the AST without touching string syntax.

```ts
import { WhenAstStruct, type WhenAst } from '@jasonkuhrt/vsv/when'
import { Schema } from 'effect'

const ast: WhenAst = Schema.decodeUnknownSync(WhenAstStruct)({
  _tag: 'WhenAnd',
  terms: [
    { _tag: 'WhenBoolKey', key: 'a' },
    { _tag: 'WhenBoolKey', key: 'b' },
  ],
})
```

### `WhenClause` — bidirectional string codec

Layered on top of `WhenAstStruct` via per-variant
`Schema.transformOrFail`. Encoded form is `string` (VS Code's clause
syntax), decoded form is `WhenAst`.

```ts
const ast = Schema.decodeUnknownSync(WhenClause)("editorLangId == 'markdown' && !inputFocus")
const text = Schema.encodeSync(WhenClause)(ast)
```

No `serializeWhen` or `parseWhenClause` helper is exported — the schema
**is** the codec. `Schema.encode(WhenClause)(ast)` produces the canonical
string. `Schema.decodeUnknown(WhenClause)(text)` parses. Combinators
recurse via `ParseResult.encode(WhenClause)` and
`ParseResult.decodeUnknown(WhenClause)` on their children.

## AST variants

| TaggedClass     | VS Code clause                | Description                                      |
| --------------- | ----------------------------- | ------------------------------------------------ |
| `WhenBoolKey`   | `editorTextFocus`             | Bare key — truthy reference                      |
| `WhenEq`        | `key == 'value'`              | Equality against a string/number/boolean         |
| `WhenNeq`       | `key != 'value'`              | Inequality                                       |
| `WhenMatch`     | `key =~ /pattern/flags`       | Regex match on the key's value                   |
| `WhenIn`        | `key in setName`              | Set membership                                   |
| `WhenCmp`       | `count >= 1`                  | Numeric comparison                               |
| `WhenNot`       | `!key` / `!(expr)`            | Negation — bare for a key, parens for a compound |
| `WhenAnd`       | `t1 && t2 && …`               | Conjunction                                      |
| `WhenOr`        | `t1 \|\| t2 \|\| …`           | Disjunction                                      |
| `WhenUnsafeRaw` | arbitrary text passed through | Escape hatch for unsupported grammar             |

Every variant is a `Schema.TaggedClass` — pattern-match with
`Match.tag('WhenAnd', ...)`, narrow via `_tag === 'WhenAnd'`, construct
via `.make({ ... })`.

## Canonical form

Encoding emits **minimal, precedence-aware parentheses** — the canonical
idiomatic form VS Code itself writes. The grammar precedence, loosest →
tightest, is:

```
||   <   &&   <   !   <   atoms / (…)
```

A combinator child is parenthesized **only** when leaving it bare would let
the parent's parser re-associate it. Everything else renders without parens:

| AST                 | Encoded           | Why                                            |
| ------------------- | ----------------- | ---------------------------------------------- |
| `And(a, b)`         | `a && b`          | atoms bind tighter than `&&` — no parens       |
| `Not(BoolKey('x'))` | `!x`              | `!` of a bare key — VS Code's own `!key` form  |
| `Not(Eq('a','b'))`  | `!(a == 'b')`     | `!` binds tighter than `==`; fence it          |
| `Or(And(a, b), c)`  | `a && b \|\| c`   | `&&` binds tighter than `\|\|` — `And` is bare |
| `And(a, Or(b, c))`  | `a && (b \|\| c)` | `\|\|` binds looser than `&&` — fence it       |
| `And(a, And(b, c))` | `a && (b && c)`   | same operator — fence to keep nesting          |

```ts
const back = Schema.decodeUnknownSync(WhenClause)(Schema.encodeSync(WhenClause)(ast))
// back deeply equals ast — minimal parens still round-trip structurally
```

`encode` is **stable / idempotent**: `encode(decode(encode(ast)))` byte-equals
`encode(ast)`. Because the emitted form is exactly the minimal idiomatic form,
a clause VS Code (or a human) already wrote in that form survives
`decode → encode` **byte-for-byte unchanged** — proven against the live
`keybindings.json` corpus in `tests/acceptance-live.test.ts`.

Decode is the same operator-precedence aware grammar: `Or` binds looser than
`And`, both looser than `Not`. `a && b || c` decodes as `Or(And(a, b), c)`.
Decode accepts both the minimal form and any over-parenthesized input — parens
are optional in parsing — so a fully-parenthesized legacy clause still decodes
to the same AST.

## `When(manifest)` builder

Constructs a manifest-typed authoring API. The manifest's declared
context keys (owned via `contextKeys`, consumed via
`externalContextKeys`) constrain key-name arguments at compile time.

| Method                         | Produces        | Key domain  | Notes                                         |
| ------------------------------ | --------------- | ----------- | --------------------------------------------- |
| `$.is(key)`                    | `WhenBoolKey`   | any         | Bare-key truthiness reference                 |
| `$.eq(key, value)`             | `WhenEq`        | any         | `value` narrowed to the key's declared domain |
| `$.neq(key, value)`            | `WhenNeq`       | any         | `value` narrowed as in `eq`                   |
| `$.match(key, pattern, flag?)` | `WhenMatch`     | open string | Regex match — only keys typed `Schema.String` |
| `$.lt` / `lte` / `gt` / `gte`  | `WhenCmp`       | numeric     | `key < n` etc. — only numeric-valued keys     |
| `$.in(key, set)`               | `WhenIn`        | any         | `key in set` — both are declared context keys |
| `$.not(inner)`                 | `WhenNot`       | —           | Negates any `WhenAst` — `!key` or `!(expr)`   |
| `$.and(a, b, …)`               | `WhenAnd`       | —           | Conjunction — requires at least two terms     |
| `$.or(a, b, …)`                | `WhenOr`        | —           | Disjunction — requires at least two terms     |
| `$.unsafe.raw(text)`           | `WhenUnsafeRaw` | —           | Escape hatch — encoded verbatim, no parse     |

`and`/`or` take `(first, second, ...rest)` — a one-term conjunction is just
the term itself, so the typed signature rejects it. (`WhenAnd.make` /
`WhenOr.make` can still construct a degenerate 0/1-term node directly; the
codec doesn't round-trip one.)

### Value-domain narrowing

Each context key's declared `valueType` Schema decodes to a TypeScript type;
that type is what `eq`/`neq` accept, and it's what gates the domain-specific
operators. The "Key domain" column above is enforced on each operator's
`key` argument:

```ts
const $ = When(manifest)

$.eq('ext.ready', true) // ✓ boolean key, boolean value
// @ts-expect-error -- 'ext.ready' is boolean; a string is not in its domain
$.eq('ext.ready', 'yes')

$.match('editorLangId', 'md') // ✓ editorLangId is Schema.String
// @ts-expect-error -- 'ext.ready' is boolean, not an open-string key
$.match('ext.ready', 'md')

$.gt('ext.lineCount', 10) // ✓ ext.lineCount is Schema.Number
// @ts-expect-error -- 'editorLangId' is a string key, not numeric
$.gt('editorLangId', 10)
```

A typo on a context-key name is likewise a compile error:

```ts
// @ts-expect-error -- 'redy' is not declared
$.is('ext.redy')
```

### Domain merging

When two decls — across `contextKeys` and `externalContextKeys` — share a
key name, the key's value domain is the **union** of their declared types.
A `vsv-markdown` sub-plugin and a `vsv-audio` sub-plugin can each declare
`activeCustomEditorId` with their own `Schema.Literal`, and
`$.eq('activeCustomEditorId', …)` accepts either literal. The merge is a
mapped type over the manifest tuple — no codegen.

## Grammar coverage

The codec was audited against VS Code's own context-key scanner and parser
(`src/vs/platform/contextkey/common/scanner.ts` + `contextkey.ts`). It
covers the grammar VS Code accepts, including:

- **Hyphenated identifiers** — `github.copilot-chat.activated`,
  `auxiliary-bar-visible`.
- **Bare-word RHS** — VS Code's `==`/`!=`/`in` accept an unquoted
  identifier as a _string_. `a == b` decodes to `WhenEq('a', 'b')`; there
  is no key-vs-key comparison in the grammar.
- **Scientific-notation numbers** — `count > 1e3`.
- **Multi-line regex patterns** — the scanner consumes any character up to
  the closing `/`.

Two things that look like gaps but are not — VS Code itself doesn't
support them, so neither does vsv:

- **No escape syntax inside `'…'` strings.** A literal `'` cannot appear
  in a quoted value; VS Code's scanner has no escape handling there.
- **Regex flags are exactly `i g s m y u`.** The ES2024 `d` and `v` flags
  are not part of the grammar.

Anything genuinely outside the grammar decodes to `WhenUnsafeRaw`, which
re-encodes verbatim.

### Normalizer, not identity round-trip

`decode` is many-to-one — several strings collapse to the same AST, and
`encode` emits one canonical form:

- Redundant parens are dropped: `(a)` → `WhenBoolKey('a')` → `a`.
- A bare-word RHS is re-emitted quoted: `a == b` → `a == 'b'`.
- Whitespace is normalized to single spaces.

So `decode(encode(decode(s)))` equals `decode(s)` — the first round-trip
canonicalizes, every subsequent one is a fixpoint.

### Guards

- `tests/property.test.ts` — fast-check round-trip over a hand-built
  generator of well-formed ASTs (`decode(encode(ast))` preserves the AST and
  `encode` is idempotent), plus the total structural codec.
- `tests/fixtures.test.ts` — real `when`-clauses harvested from VS Code's
  bundled extensions; each must decode to a typed tree (no `WhenUnsafeRaw`)
  and re-decode to a fixpoint.
- `tests/acceptance-live.test.ts` — every distinct `when` clause from the
  user's live `keybindings.json` must round-trip `decode → encode`
  byte-for-byte. A committed corpus (`live-keybindings-corpus.json`) makes
  this a durable machine-independent fence; the live file is additionally
  re-checked when present (gate with `VSV_REQUIRE_LIVE_KEYBINDINGS=1`).

## Design

See `DESIGN-typed-schema-foundations.md` at the repo root for the full
foundations design — the typed factory pattern, `defineManifest<const M>`
tuple capture, and the broader schema-supply story that the `When`
builder builds on.
