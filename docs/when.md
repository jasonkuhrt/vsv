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
// → "(activeCustomEditorId == 'vscode.markdown.preview.editor') && (!(ext.ready))"
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

| TaggedClass     | VS Code clause                | Description                              |
| --------------- | ----------------------------- | ---------------------------------------- |
| `WhenBoolKey`   | `editorTextFocus`             | Bare key — truthy reference              |
| `WhenEq`        | `key == 'value'`              | Equality against a string/number/boolean |
| `WhenNeq`       | `key != 'value'`              | Inequality                               |
| `WhenMatch`     | `key =~ /pattern/flags`       | Regex match on the key's value           |
| `WhenIn`        | `key in setName`              | Set membership                           |
| `WhenCmp`       | `count >= 1`                  | Numeric comparison                       |
| `WhenNot`       | `!(expr)`                     | Negation                                 |
| `WhenAnd`       | `(t1) && (t2) && …`           | Conjunction                              |
| `WhenOr`        | `(t1) \|\| (t2) \|\| …`       | Disjunction                              |
| `WhenUnsafeRaw` | arbitrary text passed through | Escape hatch for unsupported grammar     |

Every variant is a `Schema.TaggedClass` — pattern-match with
`Match.tag('WhenAnd', ...)`, narrow via `_tag === 'WhenAnd'`, construct
via `.make({ ... })`.

## Canonical form

Encoding fully parenthesizes all combinator children — no operator
precedence ambiguity, no formatting drift. Round-trip is structurally
preserving:

```ts
const back = Schema.decodeUnknownSync(WhenClause)(Schema.encodeSync(WhenClause)(ast))
// back deeply equals ast
```

Decode is operator-precedence aware: `Or` binds looser than `And`, both
looser than `Not`. `a && b || c` decodes as `Or(And(a, b), c)`.

## `When(manifest)` builder

Constructs a manifest-typed authoring API. The manifest's declared
context keys (owned via `contextKeys`, consumed via
`externalContextKeys`) constrain key-name arguments at compile time.

| Method               | Produces        | Notes                                               |
| -------------------- | --------------- | --------------------------------------------------- |
| `$.is(key)`          | `WhenBoolKey`   | Key must be declared in the manifest                |
| `$.eq(key, value)`   | `WhenEq`        | Same — value is `string \| number \| boolean` today |
| `$.neq(key, value)`  | `WhenNeq`       | Same                                                |
| `$.not(inner)`       | `WhenNot`       | Wraps any `WhenAst`                                 |
| `$.and(...terms)`    | `WhenAnd`       | Variadic conjunction                                |
| `$.or(...terms)`     | `WhenOr`        | Variadic disjunction                                |
| `$.unsafe.raw(text)` | `WhenUnsafeRaw` | Escape hatch — survives encoding verbatim, no parse |

A typo on a context-key name is a compile error:

```ts
const $ = When(manifest)
// @ts-expect-error -- 'redy' is not declared
$.is('ext.redy')
```

Value-domain narrowing (boolean keys accept only `is`; closed-enum keys
narrow `eq`'s value to the declared literal union; numeric keys get
comparison operators) is the next slice. Today, `eq`/`neq` accept
`string | number | boolean` for any declared key — runtime correctness
holds, but TypeScript can't yet stop you from passing a string to a
boolean-typed key.

## Known grammar holes in `WhenClause`

Documented for a focused audit pass:

- **Hyphenated identifiers** (`auxiliary-bar-visible`) — current
  identifier regex excludes `-`. Fall-through to `WhenUnsafeRaw`.
- **Backslash-escaped quotes** in string literals (`'it\\'s'`).
- **Newer regex flags** `d` and `v` — current flag set is `[gimsuy]`.
- **Key-vs-key comparison** (`key1 == key2`) — current value pattern
  requires a literal.
- **`in`-clause whitespace** — current regex requires exactly `\s+`.

A property test using `Arbitrary.make(WhenAstStruct)` to assert
`decode(encode(ast)) === ast` for randomly generated ASTs is the
intended mitigation strategy.

## Design

See `DESIGN-typed-schema-foundations.md` at the repo root for the full
foundations design — the typed factory pattern, `defineManifest<const M>`
tuple capture, and the broader schema-supply story that the `When`
builder builds on.
