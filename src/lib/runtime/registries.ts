// Manifest-derived registry types. Replace the historical codegen-emitted
// `src/generated/registries.ts` step: extension authors no longer maintain
// a generated file; the runtime reads its `defineCommand`, `defineContextKey`,
// etc. typing directly from the manifest tuple captured by
// `defineManifest<const M>`.

import type { Schema } from 'effect'
import type { ContextKeyValue } from '#lib/manifest/context-key-value'
import type { CommandDecl } from '#lib/manifest/decls/command'
import type { ConfigDecl } from '#lib/manifest/decls/config'
import type { ExternalCommandDecl } from '#lib/manifest/decls/external-command'
import type { ForeignConfigDecl } from '#lib/manifest/decls/foreign-config'
import type { StateDecl } from '#lib/manifest/decls/state'
import type { TypedManifest } from '#lib/manifest/define'

// Context-key value extraction is shared with the `When` builder — see
// `manifest/context-key-value.ts`. Re-exported so the runtime surface keeps
// `ContextKeyValue` importable from `./registries`.
export type { ContextKeyValue }

/** Extract the decoded TypeScript type of an Effect Schema, falling back to `unknown`. */
type TypeOf<S> = S extends Schema.Schema.AnyNoContext ? Schema.Schema.Type<S> : unknown

/** Discriminated `id` field union from a tuple of (Command|ExternalCommand)Decls. */
type IdOf<D> = D extends { readonly id: infer I extends string } ? I : never

/** Discriminated `name` field union from a tuple of (Context|ExternalContext)KeyDecls. */
type NameOf<D> = D extends { readonly name: infer N extends string } ? N : never

/** Tuple element accessor, defaulting to an empty tuple when the field is absent. */
type Tuple<M, K extends string> = M extends { readonly [k in K]: infer T }
  ? T extends ReadonlyArray<unknown>
    ? T
    : readonly []
  : readonly []

/**
 * Shape of one entry in a command registry. Used both as the
 * mapped-type cell shape and as the fallback when the type cannot be
 * narrowed at instantiation time.
 */
export interface CommandEntry<A = unknown, R = unknown> {
  readonly args: A
  readonly result: R
}

/** Shape of one entry in the state registry — value plus memento scope. */
export interface StateEntry<
  V = unknown,
  S extends 'global' | 'workspace' = 'global' | 'workspace',
> {
  readonly value: V
  readonly scope: S
}

/**
 * Registry of commands owned by the extension, derived from `M.commands`.
 * Each entry pairs the command's decoded `args` and `result` types.
 */
export type CommandRegistryOf<M> = {
  readonly [D in Tuple<M, 'commands'>[number] as IdOf<D>]: D extends CommandDecl<infer A, infer R>
    ? CommandEntry<TypeOf<A>, TypeOf<R>>
    : CommandEntry
}

/** Registry of commands consumed from VS Code core or other extensions. */
export type ExternalCommandRegistryOf<M> = {
  readonly [D in Tuple<M, 'externalCommands'>[number] as IdOf<D>]: D extends ExternalCommandDecl<
    infer A,
    infer R
  >
    ? CommandEntry<TypeOf<A>, TypeOf<R>>
    : CommandEntry
}

/**
 * Merged registry of context keys — owned (`contextKeys`) and consumed
 * (`externalContextKeys`). Each entry's value type comes from the shared
 * `ContextKeyValue` extractor, which unions same-named decls.
 */
export type ContextKeyRegistryOf<M> = {
  readonly [N in
    | NameOf<Tuple<M, 'contextKeys'>[number]>
    | NameOf<Tuple<M, 'externalContextKeys'>[number]>]: ContextKeyValue<M, N>
}

/** Registry of configuration settings contributed by the extension. */
export type ConfigRegistryOf<M> = {
  readonly [D in Tuple<M, 'config'>[number] as D extends { readonly key: infer K extends string }
    ? K
    : never]: D extends ConfigDecl<infer V> ? TypeOf<V> : unknown
}

/** Registry of foreign configuration settings (read-only, no contribution). */
export type ForeignConfigRegistryOf<M> = {
  readonly [D in Tuple<M, 'foreignConfig'>[number] as D extends {
    readonly fullKey: infer K extends string
  }
    ? K
    : never]: D extends ForeignConfigDecl<infer V> ? TypeOf<V> : unknown
}

/** Registry of persistent state entries, pairing value type with scope. */
export type StateRegistryOf<M> = {
  readonly [D in Tuple<M, 'state'>[number] as D extends { readonly key: infer K extends string }
    ? K
    : never]: D extends StateDecl<infer V>
    ? StateEntry<
        TypeOf<V>,
        D extends { readonly scope: infer S extends 'global' | 'workspace' } ? S : never
      >
    : StateEntry
}

/**
 * Registry of custom event channels. Currently a permissive
 * `Record<string, unknown>` — events are not yet manifest-driven.
 * Once an `EventDecl` lands, this becomes a tuple-walking mapped type
 * mirroring `CommandRegistryOf`.
 */
export type EventRegistryOf<_M> = Record<string, unknown>

/**
 * Type-level extractors. TypeScript can't directly index a mapped type
 * over a generic `M` with a literal key (e.g. `CommandRegistryOf<M>[Id]['args']`
 * fails with "Type 'args' cannot be used to index type
 * `CommandRegistryOf<M>[Id]`" because the mapped type is deferred). Use
 * `Extract` over the tuple element type to filter by `id` / `key` / `name`
 * and then a conditional `infer` to pull out the schema generic. This
 * pattern resolves to a single decl when `Id` is a literal, so call-site
 * type narrowing works as expected.
 */
export type CommandArgs<M, Id> =
  Extract<Tuple<M, 'commands'>[number], { readonly id: Id }> extends CommandDecl<infer A, infer _R>
    ? TypeOf<A>
    : unknown
export type CommandResult<M, Id> =
  Extract<Tuple<M, 'commands'>[number], { readonly id: Id }> extends CommandDecl<infer _A, infer R>
    ? TypeOf<R>
    : unknown

export type ExternalCommandArgs<M, Id> =
  Extract<Tuple<M, 'externalCommands'>[number], { readonly id: Id }> extends ExternalCommandDecl<
    infer A,
    infer _R
  >
    ? TypeOf<A>
    : unknown
export type ExternalCommandResult<M, Id> =
  Extract<Tuple<M, 'externalCommands'>[number], { readonly id: Id }> extends ExternalCommandDecl<
    infer _A,
    infer R
  >
    ? TypeOf<R>
    : unknown

type StateDeclForKey<M, K> = Extract<Tuple<M, 'state'>[number], { readonly key: K }>

export type StateValue<M, K> =
  StateDeclForKey<M, K> extends StateDecl<infer V> ? TypeOf<V> : unknown
export type StateScope<M, K> =
  StateDeclForKey<M, K> extends { readonly scope: infer S } ? S : 'global' | 'workspace'

/** Value type of an extension-owned configuration setting. */
export type ConfigValue<M, K> =
  Extract<Tuple<M, 'config'>[number], { readonly key: K }> extends ConfigDecl<infer V>
    ? TypeOf<V>
    : unknown

/** Value type of a foreign (VSCode/3rd-party) configuration setting. */
export type ForeignConfigValue<M, K> =
  Extract<Tuple<M, 'foreignConfig'>[number], { readonly fullKey: K }> extends ForeignConfigDecl<
    infer V
  >
    ? TypeOf<V>
    : unknown

/**
 * Convenience alias — any typed manifest. The runtime parameter is
 * constrained to this; consumers usually have a concrete `typeof manifest`
 * which is structurally narrower than `AnyTypedManifest`.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- AnyTypedManifest is the generic-bound; the type parameter is intentionally untyped at this boundary
export type AnyTypedManifest = TypedManifest<any>
