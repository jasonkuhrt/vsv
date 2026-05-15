// Single source of truth for context-key value-domain extraction. Both the
// runtime registry types (`runtime/registries.ts`) and the `When` builder
// (`when/builder.ts`) derive context-key value typing from this one type.
// It lives in `manifest/` because `runtime/` and `when/` may both import
// from `manifest/`, but not from each other (the import-direction invariant).

import type { Schema } from 'effect'
import type { ContextKeyDecl } from './decls/context-key.ts'
import type { ExternalContextKeyDecl } from './decls/external-context-key.ts'
import type { TypedManifest } from './define.ts'

/**
 * Decoded value domain of a context key `N` — the union of
 * `Schema.Type<valueType>` across every `contextKeys` + `externalContextKeys`
 * decl that shares the name `N`. Two decls with the same name merge to the
 * union of their value types (design Gap 3 — a mapped type over the manifest
 * tuple, no codegen).
 *
 * The distributive `ReadonlyArray<infer D>` + naked-`D` shape is load-bearing.
 * The tempting alternative — `Extract<…tuple…, { name: N }> extends
 * ContextKeyDecl<infer V, N>` — filters first, then matches with `N` *fixed*;
 * inference of `V` then fails and silently falls back to `V`'s constraint
 * `Schema.Schema.AnyNoContext`, whose decoded type is `any`. Distributing over
 * `D` first and matching each member individually infers `V` cleanly. The
 * type tests in `runtime/tests/registries.test-d.ts` are the regression fence.
 */
export type ContextKeyValue<M, N extends string> =
  M extends TypedManifest<infer Spec>
    ?
        | (Spec['contextKeys'] extends ReadonlyArray<infer D>
            ? D extends ContextKeyDecl<infer V, N>
              ? Schema.Schema.Type<V>
              : never
            : never)
        | (Spec['externalContextKeys'] extends ReadonlyArray<infer D>
            ? D extends ExternalContextKeyDecl<infer V, N>
              ? Schema.Schema.Type<V>
              : never
            : never)
    : never
