# vsv — Typed-Schema Foundations

Design doc for the next slice of vsv work. Focus is the vsv layer only.
key-binder consumes vsv; key-binder-side migration is deliberately out of
scope here. Sequenced design-decision → primitive → consumer.

## North star

vsv is "the typed VS Code SDK Microsoft never shipped." The principle is
that **every value an extension declares carries its type through TypeScript
without a codegen detour**.

Today, parts of vsv satisfy this and parts do not. The parts that do not all
share the same defect: a manifest declaration field that should carry an
_Effect Schema_ — and through it, the schema's _encoded_ and _decoded_
TypeScript types — is declared as `Schema.Unknown`. The field accepts any
value at runtime, including real schemas, but TypeScript sees `unknown`.
Type information is then reconstructed by `codegen` walking the manifest at
build time and emitting `*RegistryShape` types that the runtime imports.

The codegen path is load-bearing not because it's the _right_ place for type
flow, but because the manifest decl classes have nowhere to put the schema
type. The right end state collapses the codegen step from "produces the
type-information-of-record" to "produces side-effect artifacts (package.json,
catalog files) only" — TypeScript sees the schema type directly from the
manifest source.

## Import-direction invariant (architecture-wide)

`manifest → when` is permitted. `when → manifest` is forbidden. The `when`
module defines the AST + codec primitives independent of any manifest. The
`When` authoring builder (Gap 5) reads `Manifest` types via mapped types and
lives in `src/lib/when/builder.ts`, not in `manifest/`. Codegen and runtime
sit downstream of both. No layer reaches back up.

```
schema/  ──┐
           ├──→ manifest/  ──┐
when/   ──┘                  ├──→ runtime/
                             └──→ codegen/
```

`src/lib/schema/` (new — see Gap 0) hosts reusable Schema primitives like
`AnySchema` that more than one module needs. `manifest/` and `when/` both
consume it.

---

## Gap 0 — `AnySchema` + collapsed authoring surface

The load-bearing problem has two layers, each with its own fix:

### Runtime layer — `AnySchema`

`ContextKeyDecl.valueType: Schema.Unknown` accepts `42`, `"foo"`,
`new Date()`, or an actual Schema with equal happiness. The structural
class promises a Schema-carrying field but enforces nothing.

Effect 3.19 exports `Schema.isSchema: (u: unknown) => u is Schema.Any`.
Use it directly — no need to roll a structural `_tag` check or
`instanceof` against a union type.

```ts
// src/lib/schema/any-schema.ts
import { Schema } from 'effect'

/**
 * Runtime validator for an Effect Schema value carrying no requirements.
 * Constrained to `Schema.Any` whose `R = never`, since manifests may not
 * declare schemas that require services to decode/encode — the codegen
 * pipeline and the runtime `defineCommand`/`executeCommand` both run
 * outside any layer scope.
 *
 * Uses Effect's official `Schema.isSchema` guard, so version-stable.
 */
export const AnySchema: Schema.Schema<Schema.Schema.AnyNoContext> = Schema.declare(
  (u): u is Schema.Schema.AnyNoContext => Schema.isSchema(u),
  {
    identifier: 'AnySchema',
    description: 'An Effect Schema with no service requirements',
  },
)
```

`Schema.Schema.AnyNoContext` = `Schema<any, any, never>` is the right
constraint: any encoded/decoded shape is welcome, but `R` is forced to
`never`. A manifest decl with `R != never` would explode at codegen or
runtime decode; the validator catches it at construction time instead.

`AnySchema` lives at `src/lib/schema/any-schema.ts`, not in
`manifest/schema.ts`. `when/` and any future module needing the same
"is-this-a-Schema" validator can import it without taking a manifest
dependency.

### TypeScript layer — collapsed callable class-namespace

The naive "structural class + sibling typed factory" pattern produces
two exports per concept (`ContextKeyDecl` class + `ContextKey` factory)
and a `.make()` footgun: consumers reaching for `.make` get the
erased-generic version. The effect skill's rule (`Order.is(x)` — class
IS the namespace; sibling exports are duplication) calls this out
directly.

**Right shape:** one exported symbol per concept, callable, with the
schema and statics attached.

```ts
// src/lib/manifest/decls/context-key.ts

import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/**
 * Structural schema — what serialization, codegen, and the IR see.
 * The valueType field is erased to `Schema.Schema.AnyNoContext`.
 */
class ContextKeyDeclStruct extends Schema.TaggedClass<ContextKeyDeclStruct>()('ContextKeyDecl', {
  name: Schema.NonEmptyTrimmedString,
  valueType: AnySchema,
  defaultValue: Schema.optional(Schema.Unknown),
}) {}

/**
 * Typed authoring shape — what extension authors see at call sites.
 * Captures the value-schema type `V` so downstream mapped types
 * (Gap 2) can derive the correct operator surface.
 *
 * Structurally satisfies `ContextKeyDeclStruct` but carries the
 * tighter `valueType: V` field at the type level.
 */
export interface ContextKeyDecl<V extends Schema.Schema.AnyNoContext> extends Omit<
  ContextKeyDeclStruct,
  'valueType' | 'defaultValue'
> {
  readonly valueType: V
  readonly defaultValue?: Schema.Schema.Type<V> | undefined
}

/**
 * Typed factory + namespace. Callable like a constructor; statics
 * give access to the structural schema, the runtime guard, and the
 * type alias.
 *
 *   const k = ContextKeyDecl({ name: 'foo', valueType: Schema.Boolean })
 *   ContextKeyDecl.Struct                  // Schema for codegen/serialization
 *   ContextKeyDecl.is(x)                   // unknown -> is ContextKeyDecl<any>
 *   type T = ContextKeyDecl.Type<typeof k> // V-aware static type
 */
const factory = <V extends Schema.Schema.AnyNoContext>(spec: {
  readonly name: string
  readonly valueType: V
  readonly defaultValue?: Schema.Schema.Type<V>
}): ContextKeyDecl<V> =>
  ContextKeyDeclStruct.make({
    name: spec.name,
    valueType: spec.valueType,
    ...(spec.defaultValue !== undefined ? { defaultValue: spec.defaultValue } : {}),
  }) as ContextKeyDecl<V>

export const ContextKeyDecl = Object.assign(factory, {
  Struct: ContextKeyDeclStruct,
  is: Schema.is(ContextKeyDeclStruct),
}) as typeof factory & {
  readonly Struct: typeof ContextKeyDeclStruct
  readonly is: Schema.is.Type<typeof ContextKeyDeclStruct>
}

export namespace ContextKeyDecl {
  export type Type<D> = D extends ContextKeyDecl<infer V> ? V : never
}
```

One symbol. Callable. Statics for serialization (`.Struct`), guarding
(`.is`), and type extraction (`.Type<T>`). No `ContextKey` parallel
name; no `.make` footgun (the structural class is internal to the
module — not re-exported).

Applies symmetrically to `CommandDecl`, `ExternalCommandDecl`,
`ConfigDecl`, `ForeignConfigDecl`, `StateDecl`, and the new
`ExternalContextKeyDecl` (Gap 1). One file per decl under
`src/lib/manifest/decls/`.

### Field-by-field plan for replacing `Schema.Unknown`

| Decl                  | Field            | Today            | After Gap 0                                       |
| --------------------- | ---------------- | ---------------- | ------------------------------------------------- |
| `ContextKeyDecl`      | `valueType`      | `Schema.Unknown` | `AnySchema`, generic `V` on factory               |
| `ConfigDecl`          | `valueSchema`    | `Schema.Unknown` | `AnySchema`, generic `V` on factory               |
| `ForeignConfigDecl`   | `valueSchema`    | `Schema.Unknown` | `AnySchema`, generic `V` on factory               |
| `StateDecl`           | `valueSchema`    | `Schema.Unknown` | `AnySchema`, generic `V` on factory               |
| `CommandDecl`         | `args`, `result` | `Schema.Unknown` | `AnySchema` each, generics `A` and `R` on factory |
| `ExternalCommandDecl` | `args`, `result` | `Schema.Unknown` | `AnySchema` each, generics `A` and `R` on factory |

Eight fields total. Eight `Schema.Unknown` → `AnySchema` substitutions.
Eight factories with captured generics. Single commit.

---

## Gap 0.5 — Generic `Manifest` + `defineManifest<const M>`

Without this gap, every typed factory in Gap 0 is wasted: the moment a
`ContextKeyDecl<Schema.Boolean>` lands in
`Manifest.contextKeys: Schema.Array(ContextKeyDecl)`, the generic `V`
dies. The array's element type is the structural, erased class. Gap 3's
"mapped-type intersection over declared decls" has no tuple to map over.
The codegen detour stays load-bearing.

The fix is to make the manifest generic over its decl tuples, captured
via `<const M>` so authors don't have to manually annotate `as const`:

```ts
// src/lib/manifest/define.ts

import type { CommandDecl, ContextKeyDecl /* … */ } from './decls'

export interface ManifestSpec {
  readonly name: string
  readonly publisher: string
  readonly displayName?: string
  readonly description?: string
  readonly version?: string
  readonly engineVscode?: string
  readonly activationEvents?: ReadonlyArray<string>
  readonly extensionDependencies?: ReadonlyArray<string>
  readonly commands?: ReadonlyArray<CommandDecl<any, any>>
  readonly externalCommands?: ReadonlyArray<ExternalCommandDecl<any, any>>
  readonly contextKeys?: ReadonlyArray<ContextKeyDecl<any>>
  readonly externalContextKeys?: ReadonlyArray<ExternalContextKeyDecl<any>>
  readonly config?: ReadonlyArray<ConfigDecl<any>>
  readonly foreignConfig?: ReadonlyArray<ForeignConfigDecl<any>>
  readonly state?: ReadonlyArray<StateDecl<any>>
}

export interface TypedManifest<M extends ManifestSpec> {
  readonly _tag: 'Manifest'
  readonly spec: M
  // The structural Manifest schema (for codegen + serialization)
  // remains addressable as Manifest.Struct.
}

export const defineManifest = <const M extends ManifestSpec>(spec: M): TypedManifest<M> => ({
  _tag: 'Manifest',
  spec,
})
```

The `<const M>` modifier (TypeScript 5.0+) tells the inference engine to
preserve the spec's tuple/literal shapes without requiring authors to
write `as const`. The result is that `m.spec.contextKeys` is a tuple
type — `readonly [ContextKeyDecl<Schema.Boolean>, ContextKeyDecl<Schema.Literal<...>>, ...]` —
not an erased array. Gap 3's mapped types now have a tuple to walk.

The structural `Manifest` TaggedClass remains, accessible at
`Manifest.Struct`, and is used by codegen and serialization where the
erased shape is correct. The factory-returned `TypedManifest<M>` is the
authoring layer.

---

## Gap 1 — `ExternalContextKeyDecl`

vsv has `ExternalCommandDecl` for commands the extension _consumes_ but
does not own. There is no symmetric primitive for context keys. The
markdown-preview sub-plugin (and every consumer-side sub-plugin in
key-binder) needs to declare "I read `activeCustomEditorId`; its values
include `'vscode.markdown.preview.editor'`" without claiming to own the
key.

Same pattern as Gap 0 — structural class, typed factory, callable
namespace:

```ts
// src/lib/manifest/decls/external-context-key.ts

class ExternalContextKeyDeclStruct extends Schema.TaggedClass<ExternalContextKeyDeclStruct>()(
  'ExternalContextKeyDecl',
  {
    name: Schema.NonEmptyTrimmedString,
    valueType: AnySchema,
    ownedBy: Schema.optional(Schema.String),
  },
) {}

export interface ExternalContextKeyDecl<V extends Schema.Schema.AnyNoContext> extends Omit<
  ExternalContextKeyDeclStruct,
  'valueType'
> {
  readonly valueType: V
}

const factory = <V extends Schema.Schema.AnyNoContext>(spec: {
  readonly name: string
  readonly valueType: V
  readonly ownedBy?: string
}): ExternalContextKeyDecl<V> =>
  ExternalContextKeyDeclStruct.make({
    name: spec.name,
    valueType: spec.valueType,
    ...(spec.ownedBy !== undefined ? { ownedBy: spec.ownedBy } : {}),
  }) as ExternalContextKeyDecl<V>

export const ExternalContextKeyDecl = Object.assign(factory, {
  Struct: ExternalContextKeyDeclStruct,
  is: Schema.is(ExternalContextKeyDeclStruct),
})
```

Wired into `ManifestSpec.externalContextKeys: ReadonlyArray<ExternalContextKeyDecl<any>>`.
No `package.json#contributes.*` side effect — the extension doesn't own
these keys. Adds an entry to the generated `ExternalContextKeyRegistry`
if codegen retains a cross-decl role (see Gap 3).

---

## Gap 2 — value-domain semantics derived from Schema shape **(done)**

Once `valueType` is typed via the factory generic (Gap 0) and the
manifest preserves it via `<const M>` (Gap 0.5), the _shape_ of the
declared Schema determines which operators the `When` builder exposes
for that key. No new "domain" declarations are needed.

| `valueType` AST node           | Domain class | Operators                             |
| ------------------------------ | ------------ | ------------------------------------- |
| `BooleanKeyword`               | Boolean      | `is`, `not` (via combinator)          |
| `Literal` (string-typed)       | Closed enum  | `eq`, `neq`, `in`                     |
| `Literal` (numeric-typed)      | Closed enum  | `eq`, `neq`, `lt`, `lte`, `gt`, `gte` |
| `Union<Literal,...>`           | Closed enum  | as above, union of literal values     |
| `StringKeyword`                | Open string  | `eq`, `neq`, `match`                  |
| `NumberKeyword` / `Int` filter | Numeric      | `eq`, `neq`, `lt`, `lte`, `gt`, `gte` |

The classification lives as a mapped type at the type level, mirrored by
a runtime AST inspection (via `SchemaAST.is*` predicates — all exported
from Effect, e.g. `SchemaAST.isLiteral`, `SchemaAST.isStringKeyword`).
Type level for builder typing; runtime for any introspection codegen
needs.

---

## Gap 3 — value-domain merging across declarations **(done)**

The load-bearing first-principles decision. Multiple decl sites can
contribute values to the same context key:

- `vsv-markdown` sub-plugin declares
  `ExternalContextKeyDecl({ name: 'activeCustomEditorId', valueType: Schema.Literal('vscode.markdown.preview.editor') })`.
- `vsv-audio` sub-plugin declares
  `ExternalContextKeyDecl({ name: 'activeCustomEditorId', valueType: Schema.Literal('vscode.audioPreview') })`.

The `When.eq.activeCustomEditorId(...)` builder must accept the _union_
of contributed values across the type system.

### Two strategies

**A. Mapped-type intersection over declared tuples.** Operates on
`M['contextKeys']` and `M['externalContextKeys']` from
`TypedManifest<M>` (Gap 0.5). The mapped type groups by `name`, unions
each name's `Schema.Type<valueType>`, and produces the registry shape
that backs the `When` builder. Zero codegen for value-domain merging.

**B. Codegen-emitted registry with pre-merged unions.** Codegen walks
the manifest at build time, emits a `.ts` file with
`ExternalContextKeyRegistry = { activeCustomEditorId: 'vscode.markdown.preview.editor' | 'vscode.audioPreview' | ..., ... }`.
The `When` builder is derived from the registry, not the manifest.
Trivial mapped types; build step required.

### Pick — A

Types flow from source. A is the design — no benchmark gate. The same
mapped-type machinery already backs Gaps 4–6 (`CommandRegistryOf<M>`,
`ContextKeyRegistryOf<M>`, the `When` builder's `ContextKeyName<M>`):
walking the manifest tuple at the type level is the established pattern,
and the value-domain merge is one more mapped type over the same tuples,
not a new mechanism. Codegen stays demoted to side-effect artifacts only
(`package.json` sync, catalog files).

If type-checker latency ever becomes a measured problem on a real
consumer, strategy B (codegen-emitted pre-merged unions) is the fallback —
but that is a reaction to evidence, not a gate on landing A.

### Landing notes (post-implementation)

Gaps 2 and 3 landed together in the `When` builder (`src/lib/when/builder.ts`):

- **Classification is by decoded type, not Schema AST node.** The doc's
  table imagined matching `BooleanKeyword` / `Literal` / `StringKeyword`
  AST nodes via `SchemaAST.is*`. The shipped approach is simpler: decode
  the `valueType` to its TypeScript type (`Schema.Schema.Type<V>`) and
  test _that_ — `[value] extends [number]` for the numeric domain,
  `[string] extends [value]` to separate open `string` from a closed
  literal enum. No runtime AST walk; the classification is purely
  type-level (`NumericKeyName<M>`, `OpenStringKeyName<M>`).
- **Merge (Gap 3) was already done.** `ContextKeyValueOf<M, N>` unions
  `Schema.Type<valueType>` across every `contextKeys` + `externalContextKeys`
  decl sharing the name `N` — the strategy-A mapped type. (The runtime's
  `ContextKeyValue<M, N>` in `registries.ts` is the same type; `builder.ts`
  carries its own copy because `when/` may not import from `runtime/`.)
- **Operator gating lives on the `key` parameter**, a flat-method surface
  (`$.match(key, …)`, `$.gt(key, n)`) consistent with the runtime's
  `defineCommand(id, args)` — not a per-key sub-builder. `eq`/`neq` accept
  any key with the value narrowed; `match` accepts only `OpenStringKeyName`;
  `lt`/`lte`/`gt`/`gte` only `NumericKeyName`.

`docs/when.md`'s builder table and the `builder.test.ts` `@ts-expect-error`
assertions cover the narrowing and gating.

## Gap 4 — typed `args`/`result` per command **(done — see f494d6c, f512af9, f185edb, 6eb29f7)**

`CommandDecl.args: Schema.Unknown` and the symmetric `ExternalCommandDecl`
fields are the same defect on the command side. After Gap 0:

```ts
class CommandDeclStruct extends Schema.TaggedClass<CommandDeclStruct>()('CommandDecl', {
  id: Schema.NonEmptyTrimmedString,
  args: AnySchema,
  result: AnySchema,
  title: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
}) {}

export interface CommandDecl<
  A extends Schema.Schema.AnyNoContext,
  R extends Schema.Schema.AnyNoContext,
> extends Omit<CommandDeclStruct, 'args' | 'result'> {
  readonly args: A
  readonly result: R
}

const factory = <A extends Schema.Schema.AnyNoContext, R extends Schema.Schema.AnyNoContext>(spec: {
  readonly id: string
  readonly args: A
  readonly result: R
  readonly title?: string
  readonly category?: string
}): CommandDecl<A, R> =>
  CommandDeclStruct.make({
    /* … */
  }) as CommandDecl<A, R>

export const CommandDecl = Object.assign(factory, {
  Struct: CommandDeclStruct,
  is: Schema.is(CommandDeclStruct),
})
```

`runtime.defineCommand(id, handler)` types the handler's args and result
against the manifest decl's schemas directly via the `<const M>`
capture. The currently-documented limitation in `ExternalCommandDecl`
("the runtime's typed `executeCommand` only indexes `CommandRegistry`,
not `ExternalCommandRegistry`") closes too — typed `executeCommand(id,
args)` for external commands works through the same tuple capture.

### Landing notes (post-implementation)

The rewire landed in four commits across two repos:

- `f494d6c` — fix factory literal capture on `ExternalCommandDecl` and
  `StateDecl`. The earlier `5a53ff4` added `Id`/`K`/`S` slots to the
  type aliases but forgot to update the factory function signatures,
  so the factories always passed default `string`. Without this the
  mapped-type Extract filters in `registries.ts` couldn't discriminate
  on `{ readonly id: 'foo' }` etc. — `ExternalCommandArgs<M, 'list.expand'>`
  resolved to `unknown` / `never`.
- `f512af9` — replace the 7-generic `Runtime<CR, CKR, CFR, SR, ER, EXR, FCR>`
  with single `Runtime<M extends AnyTypedManifest>`. `createRuntime(manifest)`
  is the only entry point — no type-arg form anywhere. Adds
  `ContextKeyValue<M, N>`, `ConfigValue<M, K>`, `ForeignConfigValue<M, K>`
  extractors. Renames `ExternalCommandArgsOf` → `ExternalCommandArgs<M, Id>`
  (consistent with `CommandArgs<M, Id>`); the in-module variadic mapper
  is now `VariadicArgs<T>`. Drops all `*RegistryShape` types from
  `create.ts` and the corresponding re-exports from `src/exports/runtime.ts`.
  Migrates the 77 `createRuntime<X>()` call sites in
  `src/lib/runtime/tests/create.test.ts` to a single shared
  `testManifest = defineManifest({ ... })`.
- `f185edb` — delete `src/lib/codegen/emit-registries.ts`, its test, and
  the helper `src/lib/codegen/schema-to-ts.ts` (only used by the now-deleted
  emitter). `runCodegen` produces only `package.json` sync; `CodegenResult`
  drops `registriesPath`; `vsv dev` no longer prints the registries-file
  line. Plus three tiny rewire follow-ups: `defineEvent` impl drops the
  redundant `& string` and gets an explicit return-type annotation so K
  appears in two signature positions; bridge-thunk cast in `defineCommand`
  gets an `oxlint-disable` with reason; `scope === 'global'` in
  `defineState` gets an `oxlint-disable` for `no-unnecessary-condition`
  (oxlint can't resolve the deferred `StateScope<M, K>` mapped type and
  falsely reports the branches as unreachable).
- `6eb29f7` (workbench-cycler) — migrates the consumer. `.make({...})` →
  callable factory form. `createRuntime(manifest)` instead of generics.
  Deletes `src/generated/registries.ts`. `activate` becomes `async` so it
  can `await Effect.runPromise` for `defineContextKey` (the initial
  `setContext` call is Promise-typed at the VSCode boundary).

### What it cost / didn't cost

- 268 tests pass in vsv; full `bun run check` (format + lint + types +
  test + publint + attw) exits 0. 6/6 tests pass in workbench-cycler.
- Net diff across the two repos: −538 lines (mostly from deleting the
  codegen TS-emit pipeline and the generated `*RegistryShape` types).
- No compat shims, no `@ts-expect-error`, no temporary fallbacks. The
  earlier session's "deferred Gap 4" landing didn't survive contact with
  the work — the foundation bug (factories not capturing literals) had
  to be fixed before the rewire could even compile cleanly.

### What's still open

- `EventDecl` is the one decl still missing from the manifest. Today
  `EventRegistryOf<_M>` is a permissive `Record<string, unknown>` —
  `defineEvent('x')` accepts any string and yields `EventHandle<unknown>`.
  Adding `EventDecl` follows the same pattern as `ContextKeyDecl` (single
  factory file, `<const Name extends string>` for literal capture,
  mapped type in `registries.ts`).

---

## Gap 5 — typed `When` authoring builder

Once Gaps 0–4 land, the builder is mechanical. Lives in
`src/lib/when/builder.ts` (sibling to the AST + codec in
`src/lib/when/when.ts`):

```ts
// Sketch — actual mapped types are wider.

import type { TypedManifest } from '#lib/manifest/define'
import { WhenAnd, WhenAst, WhenBoolKey, WhenEq, WhenNot, /* … */ } from './when'

type ContextKeyRegistry<M> = /* mapped-type intersection over M.spec.contextKeys + externalContextKeys */
type WhenBuilder<M> = { /* mapped from ContextKeyRegistry<M> */ }

export const When = <M extends TypedManifest<any>>(_manifest: M): WhenBuilder<M> => /* … */
```

Each operator's `<key>` slot is generated by the mapped type derived
from the merged context-key registry (Gap 3). Builder methods produce
`WhenAst` nodes (already shipped in `when.ts`); consumers encode to
string via `Schema.encodeSync(WhenClause)(ast)` only at the
serialization boundary.

The `When` builder is **the public authoring API**. `WhenAst.make`
remains the structural construction path for low-level use;
`When(manifest).*` is the surface every extension author uses.

`when/builder.ts` imports `manifest/define.ts` types only. `when/when.ts`
imports nothing from `manifest/`. The import-direction invariant holds.

---

## Gap 6 — grammar holes in the shipped `WhenClause` codec **(done)**

Documented in commit `1b59ffb`. None block downstream consumption, but
each is a real input VS Code accepts that the codec currently routes to
`WhenUnsafeRaw`. Resolved in a dedicated audit pass.

The audit cross-checked every claimed hole against VS Code's own source
(`src/vs/platform/contextkey/common/scanner.ts` + `contextkey.ts`).
**Two of the six were mis-diagnosed** — the codec already matched VS
Code; the design doc was wrong:

| #   | Hole                                             | Verdict                                                                                                                                                                                                       |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hyphenated identifiers (`auxiliary-bar-visible`) | **Real.** Fixed — `KEY` regex now `[A-Za-z_][\w.-]*`.                                                                                                                                                         |
| 2   | String-literal escaping (`'it\'s'`)              | **Not a hole.** VS Code's `_quotedString` has no escape syntax either (TODO in its source). `'[^']*'` already matches VS Code.                                                                                |
| 3   | Regex flag set missing `d`/`v`                   | **Not a hole.** VS Code's `_regexFlags` set is exactly `{i,g,s,m,y,u}`. `[gimsuy]*` already matches.                                                                                                          |
| 4   | Key-vs-key comparison `key1 == key2`             | **Real, re-framed.** VS Code has no key-vs-key op — its `_value()` accepts a bare identifier as a _string_. Fixed — `VAL` now includes a bare-identifier alternative; `a == b` decodes to `WhenEq('a', 'b')`. |
| 5   | `in`-clause whitespace                           | **Real, re-framed.** Whitespace was fine; the real gap was the RHS surface — VS Code's `in` RHS is `_value()` (bare word _or_ quoted string). Fixed.                                                          |
| 6   | Idempotent paren canonicalization                | **Documented**, not a bug — the `WhenClause` docstring now states the codec is a normalizer (`(a)` → `a`, bare-word RHS → quoted).                                                                            |

The property test surfaced **four holes the design doc missed**, all now
fixed:

- **Scientific notation** — `String(1e21)` is `"1e+21"`; the numeric
  regex `-?\d+(?:\.\d+)?` didn't accept the `e` tail. VS Code uses
  `parseFloat`, which does. Fixed — added `(?:[eE][+-]?\d+)?`.
- **Newline in regex pattern** — `(.+)` doesn't match `\n`; VS Code's
  scanner consumes any char up to the closing `/`. Fixed — `[\s\S]+`.
- **`-0`** — `String(-0)` is `"0"`; negative zero can't round-trip.
  (Property-test filter excludes it; not a meaningful clause value.)
- **Parens inside string/regex literals** — `splitTopLevel` and
  `stripOuterParens` counted `(`/`)` blindly, so `key == '(' && other`
  mis-split. Fixed — both helpers now skip `'…'` and `/…/` literals via
  `skipLiteral`. An _unterminated_ delimiter is treated as an ordinary
  char (else a stray `'` in `WhenUnsafeRaw` text makes `WhenNot`
  re-wrapping accrete a `(…)` layer per round-trip).

### Schema tightening

- `WhenMatch.flags` is now `[gimsuy]+` (was `Schema.String`) — an empty
  or invalid flag string is unrepresentable.
- `WhenAnd`/`WhenOr` need ≥ 2 terms. This is enforced in the **builder**
  (`and`/`or` take `(first, second, ...rest)`), NOT the schema: a
  `Schema.minItems(2)` filter on the recursive `terms` field breaks
  `transformOrFail`'s encode for combinators nested in another
  combinator. `WhenAnd.make`/`WhenOr.make` can still construct a
  degenerate 0/1-term node; the codec doesn't round-trip it.

### Tests

- `tests/property.test.ts` — two properties over a hand-built
  `arbWellFormed` arbitrary (identifier keys, quote-free values, ≥ 2-term
  combinators, no `WhenUnsafeRaw`) plus `Arbitrary.make` for the total
  struct codec. A custom generator, not `Arbitrary.make(...).filter(...)`:
  the loose schema's arbitrary is mostly junk, so a filter either starves
  generation or admits non-round-trippable ASTs.
- `tests/fixtures.test.ts` — 16 real `when`-clauses harvested from VS
  Code's bundled extensions; each must decode to a typed tree (no
  `WhenUnsafeRaw`) and `re-decode` to a fixpoint.

---

## Gap 7 — `WhenClause` codec discoverability **(done)**

The codec ships as a public subpath (`@jasonkuhrt/vsv/when`) but was not
narrated. `docs/when.md` covers it:

- Two-layer split (`WhenAstStruct` vs `WhenClause`).
- Per-variant codec design (the AST-variant table).
- The `When` builder — manifest-typed authoring API.

`docs/when.md` was first written in `bacac94` (right after Gap 5) and
refreshed for Gap 6: the "Known grammar holes" section — which listed the
holes as open and two of them mis-diagnosed — is replaced by a "Grammar
coverage" section stating what the audited codec supports, the
normalizer (not identity round-trip) behaviour, and the property +
fixture guards.

---

## Sequencing

Each numbered step is one commit.

1. **Gap 0** — `src/lib/schema/any-schema.ts` (new module). Replace
   `Schema.Unknown` across all eight decl fields with `AnySchema`.
   Restructure each decl as callable class-namespace under
   `src/lib/manifest/decls/`. Existing `.make`-style call sites
   migrate; no backwards-compat shim.
2. **Gap 0.5** — `defineManifest<const M>` + `TypedManifest<M>`. The
   structural `Manifest` TaggedClass becomes `Manifest.Struct` for
   codegen/serialization; the authoring layer is the `TypedManifest`
   capture.
3. **Gap 1** — `ExternalContextKeyDecl`. Wire into
   `ManifestSpec.externalContextKeys`.
4. **Gap 4** — Tighten `CommandDecl` and `ExternalCommandDecl` factory
   generics. Update runtime `defineCommand`/`executeCommand` typing to
   read from the manifest tuple, not codegen registries.
5. **Gap 2 + Gap 3** — value-domain mapped types derived from the
   manifest tuple (strategy A). No benchmark gate.
6. **Gap 5** — `When` builder. `src/lib/when/builder.ts`. Imports
   `manifest/define.ts` types only.
7. **Gap 6** — grammar audit on `WhenClause`. Property-test pass with
   a hand-built well-formed-AST arbitrary. Fixture corpus from
   real-world clauses.
8. **Gap 7** — `docs/when.md`.

Gaps 0–4 are the schema-side foundation. Gap 5 is the downstream
authoring API. Gaps 6–7 are quality and discoverability.

## Out of scope

- key-binder's migration off `VsCodeWhenClause` onto vsv's typed
  builder. Tracked in key-binder.
- Adapters for non-VS Code editors. Same schema-supply pattern, but in
  the Neovim/Obsidian adapter repos.
- Backwards compatibility. Every decl call site changes shape; vsv is
  pre-publication and full-cut migration is the project principle.
