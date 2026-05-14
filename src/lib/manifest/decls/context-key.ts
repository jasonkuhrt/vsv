import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/** Structural schema. */
export class ContextKeyDeclStruct extends Schema.TaggedClass<ContextKeyDeclStruct>()(
  'ContextKeyDecl',
  {
    name: Schema.NonEmptyTrimmedString,
    valueType: AnySchema,
    defaultValue: Schema.optional(Schema.Unknown),
  },
) {}

/** Typed authoring shape with the value schema and name literal preserved. */
export type ContextKeyDecl<
  V extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  N extends string = string,
> = Omit<ContextKeyDeclStruct, 'name' | 'valueType' | 'defaultValue'> & {
  readonly name: N
  readonly valueType: V
  readonly defaultValue?: Schema.Schema.Type<V> | undefined
}

/**
 * Declares a context key — a named runtime flag VS Code can branch on
 * inside `when` clauses for keybindings, menus, and view visibility.
 * Set via `runtime.defineContextKey(name, value)`.
 *
 * The `valueType` Schema *is* the value domain. Its shape drives which
 * operators the `When` builder exposes for this key (e.g. boolean keys
 * get `is`/`not`, string-literal keys get `eq`/`neq`/`in`).
 *
 * Fields
 * ------
 * - `name` — the context key name as referenced in `when` clauses.
 *   Convention: camelCase (`myExt.featureEnabled`).
 * - `valueType` — Effect Schema describing the value type. Typically
 *   `Schema.Boolean`, `Schema.Literal(...)` for closed enums, or
 *   `Schema.String` for open string domains.
 * - `defaultValue` — optional initial value seeded when the runtime
 *   first defines the key.
 */
const factory = <V extends Schema.Schema.AnyNoContext, const N extends string>(spec: {
  readonly name: N
  readonly valueType: V
  readonly defaultValue?: Schema.Schema.Type<V>
}): ContextKeyDecl<V, N> => {
  const struct = ContextKeyDeclStruct.make({
    name: spec.name,
    valueType: spec.valueType,
    ...(spec.defaultValue !== undefined ? { defaultValue: spec.defaultValue } : {}),
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- factory captures V and the name literal N on the returned value
  return struct as ContextKeyDecl<V, N>
}

export const ContextKeyDecl = Object.assign(factory, {
  Struct: ContextKeyDeclStruct,
  is: Schema.is(ContextKeyDeclStruct),
})
