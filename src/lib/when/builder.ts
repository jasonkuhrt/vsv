// Typed `When` authoring builder. Produces `WhenAst` nodes from a
// manifest-typed surface — context-key names come from the declared
// `contextKeys` + `externalContextKeys` tuples, so a typo is a compile
// error.
//
// MVP surface: combinators (`and`, `or`, `not`), the boolean atom `is(key)`,
// the value-comparison atom `eq(key, value)`, and a structured-but-untyped
// escape hatch `unsafe.raw(text)`. Value-domain narrowing (boolean → only
// `is`; string-literal → typed `eq` value union; numeric → comparison
// operators) is the next slice — it requires a mapped type that
// discriminates on each declared `valueType`'s Schema AST node. The
// builder's runtime behaviour is final; only its type-level surface
// tightens in that follow-up.

import type { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import type { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import type { TypedManifest } from '#lib/manifest/define'
import {
  WhenAnd,
  type WhenAst,
  WhenBoolKey,
  WhenEq,
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

/**
 * The typed `When` builder produced by `When(manifest)`. Methods produce
 * `WhenAst` nodes — never strings. Encoding to VS Code's when-clause
 * syntax happens via `Schema.encodeSync(WhenClause)(ast)` at the
 * serialization boundary.
 */
export interface WhenBuilder<M> {
  /**
   * Boolean atom — `key`. Compiles to `WhenBoolKey({ key })`. Use for
   * keys whose `valueType` is `Schema.Boolean` (or as the bare-key form
   * for value-keyed contexts when no value comparison is needed).
   */
  readonly is: (key: ContextKeyName<M>) => WhenAst

  /**
   * Equality atom — `key == value`. Compiles to `WhenEq({ key, value })`.
   * Value-type narrowing per declared `valueType` is a follow-up; today
   * `value` accepts `string | number | boolean`.
   */
  readonly eq: (key: ContextKeyName<M>, value: string | number | boolean) => WhenAst

  /** Inequality atom — `key != value`. */
  readonly neq: (key: ContextKeyName<M>, value: string | number | boolean) => WhenAst

  /** Negation — `!(inner)`. */
  readonly not: (inner: WhenAst) => WhenAst

  /** Conjunction — `(t1) && (t2) && …`. */
  readonly and: (...terms: ReadonlyArray<WhenAst>) => WhenAst

  /** Disjunction — `(t1) || (t2) || …`. */
  readonly or: (...terms: ReadonlyArray<WhenAst>) => WhenAst

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
 * context keys (owned + external) constrain `is`/`eq`/`neq` to legal
 * key names.
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
  eq: (key, value) => WhenEq.make({ key, value }),
  neq: (key, value) => WhenNeq.make({ key, value }),
  not: (inner) => WhenNot.make({ inner }),
  and: (...terms) => WhenAnd.make({ terms }),
  or: (...terms) => WhenOr.make({ terms }),
  unsafe: {
    raw: (text) => WhenUnsafeRaw.make({ text }),
  },
})
