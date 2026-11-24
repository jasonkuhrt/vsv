import { Schema } from 'effect';
import { AnySchema } from '#lib/schema/any-schema';
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';

/**
 * @description Structural schema.
 */
export class ConfigDeclStruct extends Schema.TaggedClass<
  ConfigDeclStruct,
  {}
>()('ConfigDecl', {
  key: NonEmptyTrimmedString,
  valueSchema: AnySchema,
  description: Schema.optional(Schema.String),
}) {}

/**
 * @description Typed authoring shape with the value schema preserved.
 */
export type ConfigDecl<
  V extends Schema.ConstraintCodec<unknown, unknown> = Schema.ConstraintCodec<
    unknown,
    unknown
  >,
  K extends string = string,
> = Omit<ConfigDeclStruct, 'key' | 'valueSchema'> & {
  readonly key: K;
  readonly valueSchema: V;
};

/**
 * @description Declares a configuration setting **contributed by this
 * extension** — surfaced in `package.json` under `contributes.configuration`
 * and accessed via `runtime.defineConfig(key)`.
 *
 * Use `ForeignConfigDecl` for settings owned by VS Code core or another
 * extension; re-contributing those would corrupt VS Code's settings UI.
 *
 * ## Fields
 *
 * - `key` — the setting key (e.g. `myExt.feature.threshold`).
 * - `valueSchema` — Effect Schema describing the setting's value type. Drives
 *   both runtime typing and the generated configuration contribution in
 *   `package.json`.
 * - `description` — user-facing description shown in VS Code's settings UI.
 */
const factory = <
  V extends Schema.ConstraintCodec<unknown, unknown>,
  const K extends string,
>(spec: {
  readonly key: K;
  readonly valueSchema: V;
  readonly description?: string;
}): ConfigDecl<V, K> => {
  const input = {
    key: spec.key,
    valueSchema: spec.valueSchema,
    ...(spec.description === undefined
      ? {}
      : { description: spec.description }),
  };
  return Object.assign(ConfigDeclStruct.make(input), input);
};

export const ConfigDecl = Object.assign(factory, {
  Struct: ConfigDeclStruct,
  is: Schema.is(ConfigDeclStruct),
});
