// Typed manifest factory. The structural `Manifest` TaggedClass from
// `./schema.ts` describes the manifest's runtime/serialization shape; this
// module's `defineManifest<const M>` captures the spec's tuple shape at the
// type level so downstream mapped types (e.g. the `When` builder's
// context-key registry) can read declared schemas, names, and decl-specific
// generics directly from the source manifest — no codegen detour.

import type { CommandDecl } from './decls/command.ts'
import type { ConfigDecl } from './decls/config.ts'
import type { ContextKeyDecl } from './decls/context-key.ts'
import type { ExternalCommandDecl } from './decls/external-command.ts'
import type { ForeignConfigDecl } from './decls/foreign-config.ts'
import type { StateDecl } from './decls/state.ts'
import { Manifest } from './schema.ts'

/**
 * Input shape for `defineManifest`. Mirrors the structural `Manifest`
 * TaggedClass's fields but each decl-array slot is left open so the
 * authoring-time tuple is preserved by `<const M>`.
 */
export interface ManifestSpec {
  readonly name: string
  readonly publisher: string
  readonly displayName?: string
  readonly description?: string
  readonly version?: string
  readonly engineVscode?: string
  readonly activationEvents?: ReadonlyArray<string>
  readonly extensionDependencies?: ReadonlyArray<string>
  readonly commands?: ReadonlyArray<CommandDecl>
  readonly externalCommands?: ReadonlyArray<ExternalCommandDecl>
  readonly contextKeys?: ReadonlyArray<ContextKeyDecl>
  readonly config?: ReadonlyArray<ConfigDecl>
  readonly foreignConfig?: ReadonlyArray<ForeignConfigDecl>
  readonly state?: ReadonlyArray<StateDecl>
}

/**
 * Typed result of `defineManifest`. Carries the spec's literal tuple
 * shape (commands/contextKeys/etc. typed as the actual tuple, not as
 * erased arrays), with the `_tag: 'Manifest'` discriminator added so
 * structural consumers (codegen, serialization) accept it wherever they
 * accept a `Manifest`.
 */
export type TypedManifest<M extends ManifestSpec> = M & { readonly _tag: 'Manifest' }

/**
 * Author a vsv extension manifest. The `<const M>` parameter preserves
 * the spec's literal tuple types — `m.commands` is typed as the actual
 * declared tuple, not as `ReadonlyArray<CommandDecl>`. Downstream mapped
 * types use this to recover schema generics declared on each entry.
 *
 * Validates the spec at runtime against the structural `Manifest`
 * schema — same checks as `Manifest.make(spec)`, but the return type is
 * tightened to `TypedManifest<M>` rather than the erased `Manifest`.
 *
 * @example
 * ```ts
 * import { defineManifest, ContextKeyDecl } from '@jasonkuhrt/vsv/manifest'
 *
 * const m = defineManifest({
 *   name: 'my-ext',
 *   publisher: 'jasonkuhrt',
 *   contextKeys: [
 *     ContextKeyDecl({ name: 'myExt.ready', valueType: Schema.Boolean }),
 *   ],
 * })
 *
 * // Type-level: m.contextKeys is `readonly [ContextKeyDecl<typeof Schema.Boolean>]`
 * // — the tuple position, name, and value-schema generic are all preserved.
 * ```
 */
export const defineManifest = <const M extends ManifestSpec>(spec: M): TypedManifest<M> => {
  const validated = Manifest.make(spec)
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structural Manifest.make validates fields; the cast tightens the return type to TypedManifest<M> which preserves M's tuple captures
  return validated as unknown as TypedManifest<M>
}
