import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/** Structural schema. */
export class StateDeclStruct extends Schema.TaggedClass<StateDeclStruct>()('StateDecl', {
  key: Schema.NonEmptyTrimmedString,
  scope: Schema.Literal('global', 'workspace'),
  valueSchema: AnySchema,
}) {}

/** Typed authoring shape with the value schema preserved. */
export type StateDecl<
  V extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  K extends string = string,
  S extends 'global' | 'workspace' = 'global' | 'workspace',
> = Omit<StateDeclStruct, 'key' | 'scope' | 'valueSchema'> & {
  readonly key: K
  readonly scope: S
  readonly valueSchema: V
}

/**
 * Declares persistent state — a key-value entry backed by VS Code's
 * `globalState` (machine-wide) or `workspaceState` (per-workspace)
 * memento. Accessed at runtime via `runtime.defineState(ctx, key, scope)`.
 *
 * Fields
 * ------
 * - `key` — the storage key. Namespace explicitly (e.g.
 *   `myExt.featureLastRun`) since global state shares one keyspace
 *   across extensions.
 * - `scope` — `'global'` (synced via VS Code Settings Sync if enabled,
 *   machine-wide) or `'workspace'` (local to the current workspace).
 * - `valueSchema` — Effect Schema describing the stored value type. The
 *   memento serializes via `JSON.stringify`, so the schema must describe
 *   a JSON-serializable shape.
 */
const factory = <
  V extends Schema.Schema.AnyNoContext,
  const K extends string,
  const S extends 'global' | 'workspace',
>(spec: {
  readonly key: K
  readonly scope: S
  readonly valueSchema: V
}): StateDecl<V, K, S> => {
  const struct = StateDeclStruct.make({
    key: spec.key,
    scope: spec.scope,
    valueSchema: spec.valueSchema,
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- factory captures V plus the key literal K and scope literal S on the returned value
  return struct as StateDecl<V, K, S>
}

export const StateDecl = Object.assign(factory, {
  Struct: StateDeclStruct,
  is: Schema.is(StateDeclStruct),
})
