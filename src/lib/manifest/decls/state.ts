import { Schema } from 'effect';
import { AnySchema } from '#lib/schema/any-schema';
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';

/**
 * @description Structural schema.
 */
export class StateDeclStruct extends Schema.TaggedClass<StateDeclStruct, {}>()(
  'StateDecl',
  {
    key: NonEmptyTrimmedString,
    scope: Schema.Literals(['global', 'workspace']),
    valueSchema: AnySchema,
  },
) {}

/**
 * @description Typed authoring shape with the value schema preserved.
 */
export type StateDecl<
  V extends Schema.ConstraintCodec<unknown, unknown> = Schema.ConstraintCodec<
    unknown,
    unknown
  >,
  K extends string = string,
  S extends 'global' | 'workspace' = 'global' | 'workspace',
> = Omit<StateDeclStruct, 'key' | 'scope' | 'valueSchema'> & {
  readonly key: K;
  readonly scope: S;
  readonly valueSchema: V;
};

/**
 * @description Declares persistent state — a key-value entry backed by VS
 * Code's `globalState` (machine-wide) or `workspaceState` (per-workspace)
 * memento. Accessed at runtime via `runtime.defineState(ctx, key, scope)`.
 *
 * ## Fields
 *
 * - `key` — the storage key. Namespace explicitly (e.g. `myExt.featureLastRun`)
 *   since global state shares one keyspace across extensions.
 * - `scope` — `'global'` (synced via VS Code Settings Sync if enabled,
 *   machine-wide) or `'workspace'` (local to the current workspace).
 * - `valueSchema` — Effect Schema describing the stored value type. The memento
 *   serializes via `JSON.stringify`, so the schema must describe a
 *   JSON-serializable shape.
 */
const factory = <
  V extends Schema.ConstraintCodec<unknown, unknown>,
  const K extends string,
  const S extends 'global' | 'workspace',
>(spec: {
  readonly key: K;
  readonly scope: S;
  readonly valueSchema: V;
}): StateDecl<V, K, S> => {
  const input = {
    key: spec.key,
    scope: spec.scope,
    valueSchema: spec.valueSchema,
  };
  return Object.assign(StateDeclStruct.make(input), input);
};

export const StateDecl = Object.assign(factory, {
  Struct: StateDeclStruct,
  is: Schema.is(StateDeclStruct),
});
