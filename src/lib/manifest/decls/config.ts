import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/** Structural schema. */
export class ConfigDeclStruct extends Schema.TaggedClass<ConfigDeclStruct>()('ConfigDecl', {
  key: Schema.NonEmptyTrimmedString,
  valueSchema: AnySchema,
  description: Schema.optional(Schema.String),
}) {}

/** Typed authoring shape with the value schema preserved. */
export type ConfigDecl<V extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext> = Omit<
  ConfigDeclStruct,
  'valueSchema'
> & { readonly valueSchema: V }

/**
 * Declares a configuration setting **contributed by this extension** —
 * surfaced in `package.json` under `contributes.configuration` and
 * accessed via `runtime.defineConfig(key)`.
 *
 * Use `ForeignConfigDecl` for settings owned by VS Code core or another
 * extension; re-contributing those would corrupt VS Code's settings UI.
 *
 * Fields
 * ------
 * - `key` — the setting key (e.g. `myExt.feature.threshold`).
 * - `valueSchema` — Effect Schema describing the setting's value type.
 *   Drives both runtime typing and the generated configuration
 *   contribution in `package.json`.
 * - `description` — user-facing description shown in VS Code's settings
 *   UI.
 */
const factory = <V extends Schema.Schema.AnyNoContext>(spec: {
  readonly key: string
  readonly valueSchema: V
  readonly description?: string
}): ConfigDecl<V> => {
  const struct = ConfigDeclStruct.make({
    key: spec.key,
    valueSchema: spec.valueSchema,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- factory captures V on the returned value
  return struct as ConfigDecl<V>
}

export const ConfigDecl = Object.assign(factory, {
  Struct: ConfigDeclStruct,
  is: Schema.is(ConfigDeclStruct),
})
