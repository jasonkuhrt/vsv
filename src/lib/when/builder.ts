// Typed `When` authoring builder. Produces `WhenAst` nodes from a
// manifest-typed surface — context-key names come from the declared
// `contextKeys` + `externalContextKeys` tuples, so a typo is a compile
// error.
//
// Value-domain narrowing: each key's declared `valueType` Schema decodes to
// a TypeScript type, merged across every decl that shares the key's name
// (`ContextKeyValue`). `eq`/`neq` narrow their `value` argument to that
// domain; `match` is offered only for open-`string` keys; `lt`/`lte`/`gt`/
// `gte` only for numeric keys. The constraint lives on each operator's `key`
// parameter — a flat-method surface, consistent with the runtime's
// `defineCommand(id, args)`.

import type { ContextKeyValue, ContextKeyValueArg } from '#lib/manifest/context-key-value'
import type { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import type { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import type { TypedManifest } from '#lib/manifest/define'
import {
  WhenAnd,
  type WhenAst,
  WhenBoolKey,
  WhenCmp,
  WhenEq,
  WhenIn,
  WhenMatch,
  WhenNeq,
  WhenNot,
  WhenOr,
  WhenUnsafeRaw,
} from './when.ts'

/**
 * Union of context-key names declared by a typed manifest, across both
 * owned (`contextKeys`) and consumed (`externalContextKeys`) decl arrays.
 * Resolves to `never` when no keys are declared, so any binding that
 * references a key on an empty manifest is a compile error.
 */
export type ContextKeyName<M> =
  M extends TypedManifest<infer Spec>
    ?
        | (Spec['contextKeys'] extends ReadonlyArray<infer D>
            ? D extends ContextKeyDecl
              ? D['name']
              : never
            : never)
        | (Spec['externalContextKeys'] extends ReadonlyArray<infer D>
            ? D extends ExternalContextKeyDecl
              ? D['name']
              : never
            : never)
    : never

// The context-key value-domain extractor lives in `manifest/` — shared with
// the runtime registry types. Re-exported here so `When` builder consumers
// can name the value type without reaching across modules.
export type { ContextKeyValue }

/**
 * Context-key names whose merged value domain is numeric — open `number` or
 * a numeric literal union. The comparison operators (`lt`/`lte`/`gt`/`gte`)
 * accept only these.
 */
export type NumericKeyName<M> = {
  readonly [N in ContextKeyName<M> & string]: [ContextKeyValue<M, N>] extends [number] ? N : never
}[ContextKeyName<M> & string]

/**
 * Context-key names whose merged value domain is the open `string` type —
 * not a closed literal enum. `match` (regex) accepts only these: regex-
 * matching a key already pinned to a literal union is meaningless.
 */
export type OpenStringKeyName<M> = {
  readonly [N in ContextKeyName<M> & string]: [string] extends [ContextKeyValue<M, N>] ? N : never
}[ContextKeyName<M> & string]

/**
 * The typed `When` builder produced by `When(manifest)`. Methods produce
 * `WhenAst` nodes — never strings. Encoding to VS Code's when-clause
 * syntax happens via `Schema.encodeSync(WhenClause)(ast)` at the
 * serialization boundary.
 */
export interface WhenBuilder<M> {
  /**
   * Boolean atom — `key`. Compiles to `WhenBoolKey({ key })`. Accepts any
   * declared key: a bare-key reference reads the key's truthiness.
   */
  readonly is: (key: ContextKeyName<M>) => WhenAst

  /**
   * Equality atom — `key == value`. The `value` argument is narrowed to the
   * key's declared authoring value domain (`ContextKeyValueArg`): a boolean
   * key accepts `boolean`, a `Schema.Literal('a', 'b')` key accepts
   * `'a' | 'b'`. For an `OpenEnum`-typed key the argument is the bare
   * known-member string union plus an open-string escape — the known members
   * autocomplete while an unmodeled string is still accepted (a `when` clause
   * may legitimately compare a value outside the modeled core membership).
   */
  readonly eq: <K extends ContextKeyName<M> & string>(
    key: K,
    value: ContextKeyValueArg<M, K>,
  ) => WhenAst

  /** Inequality atom — `key != value`. Value narrowed as in `eq`. */
  readonly neq: <K extends ContextKeyName<M> & string>(
    key: K,
    value: ContextKeyValueArg<M, K>,
  ) => WhenAst

  /**
   * Regex-match atom — `key =~ /pattern/flags`. Offered only for keys whose
   * value domain is the open `string` type; a closed literal-enum key has
   * nothing to regex-match.
   */
  readonly match: (key: OpenStringKeyName<M>, pattern: string, flags?: string) => WhenAst

  /** Less-than comparison — `key < value`. Numeric keys only. */
  readonly lt: (key: NumericKeyName<M>, value: number) => WhenAst
  /** Less-than-or-equal comparison — `key <= value`. Numeric keys only. */
  readonly lte: (key: NumericKeyName<M>, value: number) => WhenAst
  /** Greater-than comparison — `key > value`. Numeric keys only. */
  readonly gt: (key: NumericKeyName<M>, value: number) => WhenAst
  /** Greater-than-or-equal comparison — `key >= value`. Numeric keys only. */
  readonly gte: (key: NumericKeyName<M>, value: number) => WhenAst

  /**
   * Set-membership atom — `key in set`. Both arguments are declared context
   * keys; `set` names a key whose value is the collection being tested.
   */
  readonly in: (key: ContextKeyName<M>, set: ContextKeyName<M>) => WhenAst

  /** Negation — `!key` for a bare key, `!(inner)` for a compound. */
  readonly not: (inner: WhenAst) => WhenAst

  /**
   * Conjunction — `t1 && t2 && …` (minimal parens; an `Or` or nested `And`
   * term is fenced). Requires at least two terms; a one-term `&&` is just the
   * term itself, and `WhenAnd` rejects it.
   */
  readonly and: (first: WhenAst, second: WhenAst, ...rest: ReadonlyArray<WhenAst>) => WhenAst

  /**
   * Disjunction — `t1 || t2 || …` (minimal parens; a nested `Or` term is
   * fenced). Requires at least two terms; a one-term `||` is just the term
   * itself, and `WhenOr` rejects it.
   */
  readonly or: (first: WhenAst, second: WhenAst, ...rest: ReadonlyArray<WhenAst>) => WhenAst

  /**
   * Untyped escape hatch for clauses that reference context keys not
   * declared in the manifest, or that use grammar shapes the typed
   * surface doesn't cover yet. Produces a `WhenUnsafeRaw` node that
   * survives encoding verbatim. Validate the text before passing it
   * here — vsv doesn't parse it.
   */
  readonly unsafe: {
    readonly raw: (text: string) => WhenAst
  }
}

/**
 * Construct a manifest-typed `When` builder. The manifest's declared
 * context keys (owned + external) constrain `is`/`eq`/`neq`/… to legal
 * key names, and each key's declared `valueType` narrows the value
 * arguments.
 *
 * @example
 * ```ts
 * import { defineManifest, ContextKeyDecl, ExternalContextKeyDecl } from '@jasonkuhrt/vsv/manifest'
 * import { When, WhenClause } from '@jasonkuhrt/vsv/when'
 * import { Schema } from 'effect'
 *
 * const manifest = defineManifest({
 *   name: 'ext',
 *   publisher: 'jasonkuhrt',
 *   contextKeys: [
 *     ContextKeyDecl({ name: 'ext.ready', valueType: Schema.Boolean }),
 *   ],
 *   externalContextKeys: [
 *     ExternalContextKeyDecl({
 *       name: 'activeCustomEditorId',
 *       valueType: Schema.Literal('vscode.markdown.preview.editor'),
 *     }),
 *   ],
 * })
 *
 * const $ = When(manifest)
 * const ast = $.and(
 *   $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor'),
 *   $.not($.is('ext.ready')),
 * )
 * const clause: string = Schema.encodeSync(WhenClause)(ast)
 * ```
 */
export const When = <
  M extends TypedManifest<{ readonly name: string; readonly publisher: string }>,
>(
  _manifest: M,
): WhenBuilder<M> => ({
  is: (key) => WhenBoolKey.make({ key }),
  eq: (key, value) =>
    // The value is narrowed to `ContextKeyValue<M, K>` at the call site;
    // `WhenEq` only accepts the `string | number | boolean` primitive union.
    // Context-key value domains are always primitive in practice, but the
    // schema doesn't enforce that, so the assertion lives at this boundary.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above
    WhenEq.make({ key, value: value as string | number | boolean }),
  neq: (key, value) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see `eq` above
    WhenNeq.make({ key, value: value as string | number | boolean }),
  match: (key, pattern, flags) =>
    WhenMatch.make(flags === undefined ? { key, pattern } : { key, pattern, flags }),
  lt: (key, value) => WhenCmp.make({ key, op: '<', value }),
  lte: (key, value) => WhenCmp.make({ key, op: '<=', value }),
  gt: (key, value) => WhenCmp.make({ key, op: '>', value }),
  gte: (key, value) => WhenCmp.make({ key, op: '>=', value }),
  in: (key, set) => WhenIn.make({ key, set }),
  not: (inner) => WhenNot.make({ inner }),
  and: (first, second, ...rest) => WhenAnd.make({ terms: [first, second, ...rest] }),
  or: (first, second, ...rest) => WhenOr.make({ terms: [first, second, ...rest] }),
  unsafe: {
    raw: (text) => WhenUnsafeRaw.make({ text }),
  },
})
