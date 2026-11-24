import { Schema } from 'effect';
import { AnySchema } from '#lib/schema/any-schema';
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';

/**
 * @description Structural schema.
 */
export class ContextKeyDeclStruct extends Schema.TaggedClass<
  ContextKeyDeclStruct,
  {}
>()('ContextKeyDecl', {
  name: NonEmptyTrimmedString,
  valueType: AnySchema,
  defaultValue: Schema.optional(Schema.Unknown),
}) {}

/**
 * @description Typed authoring shape with the value schema and name literal
 * preserved.
 */
export type ContextKeyDecl<
  V extends Schema.ConstraintCodec<unknown, unknown> = Schema.ConstraintCodec<
    unknown,
    unknown
  >,
  N extends string = string,
> = Omit<ContextKeyDeclStruct, 'name' | 'valueType' | 'defaultValue'> & {
  readonly name: N;
  readonly valueType: V;
  readonly defaultValue?: V['Type'] | undefined;
};

/**
 * @description Declares a context key — a named runtime flag VS Code can branch
 * on inside `when` clauses for keybindings, menus, and view visibility. Set via
 * `runtime.defineContextKey(name, value)`.
 *
 * The `valueType` Schema _is_ the value domain. Its shape drives which
 * operators the `When` builder exposes for this key (e.g. boolean keys get
 * `is`/`not`, string-literal keys get `eq`/`neq`/`in`).
 *
 * ## Fields
 *
 * - `name` — the context key name as referenced in `when` clauses. Convention:
 *   camelCase (`myExt.featureEnabled`).
 * - `valueType` — Effect Schema describing the value type. Typically
 *   `Schema.Boolean`, `Schema.Literal(...)` for closed enums, or
 *   `Schema.String` for open string domains.
 * - `defaultValue` — optional initial value seeded when the runtime first defines
 *   the key.
 */
const factory = <
  V extends Schema.ConstraintCodec<unknown, unknown>,
  const N extends string,
>(spec: {
  readonly name: N;
  readonly valueType: V;
  readonly defaultValue?: V['Type'];
}): ContextKeyDecl<V, N> => {
  const input = {
    name: spec.name,
    valueType: spec.valueType,
    ...(spec.defaultValue === undefined
      ? {}
      : { defaultValue: spec.defaultValue }),
  };
  return Object.assign(ContextKeyDeclStruct.make(input), input);
};

export const ContextKeyDecl = Object.assign(factory, {
  Struct: ContextKeyDeclStruct,
  is: Schema.is(ContextKeyDeclStruct),
});
