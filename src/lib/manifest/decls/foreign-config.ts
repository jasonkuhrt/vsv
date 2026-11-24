import { Schema } from 'effect';
import { AnySchema } from '#lib/schema/any-schema';
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';

/**
 * @description Structural schema.
 */
export class ForeignConfigDeclStruct extends Schema.TaggedClass<
  ForeignConfigDeclStruct,
  {}
>()('ForeignConfigDecl', {
  fullKey: NonEmptyTrimmedString,
  valueSchema: AnySchema,
  ownedBy: Schema.optional(Schema.String),
}) {}

/**
 * @description Typed authoring shape with the value schema preserved.
 */
export type ForeignConfigDecl<
  V extends Schema.ConstraintCodec<unknown, unknown> = Schema.ConstraintCodec<
    unknown,
    unknown
  >,
  K extends string = string,
> = Omit<ForeignConfigDeclStruct, 'fullKey' | 'valueSchema'> & {
  readonly fullKey: K;
  readonly valueSchema: V;
};

/**
 * @description Declares a configuration setting **owned by VS Code core or
 * another extension** that this extension reads/writes but does not contribute.
 * Adds the key to the generated `ForeignConfigRegistry` and gives a typed
 * accessor via `runtime.defineForeignConfig(fullKey)`. **Not** synced into
 * `package.json#contributes.configuration` — re-contributing a foreign key
 * would corrupt VS Code's settings UI.
 *
 * ## Fields
 *
 * - `fullKey` — the dotted setting path as it appears in `settings.json` (e.g.
 *   `editor.codeLens`, `explorer.confirmDelete`).
 * - `valueSchema` — Effect Schema describing the value type. Drives the typed
 *   accessor returned by `defineForeignConfig`.
 * - `ownedBy` — optional documentation note ("vscode core", "publisher.ext").
 */
const factory = <
  V extends Schema.ConstraintCodec<unknown, unknown>,
  const K extends string,
>(spec: {
  readonly fullKey: K;
  readonly valueSchema: V;
  readonly ownedBy?: string;
}): ForeignConfigDecl<V, K> => {
  const input = {
    fullKey: spec.fullKey,
    valueSchema: spec.valueSchema,
    ...(spec.ownedBy === undefined ? {} : { ownedBy: spec.ownedBy }),
  };
  return Object.assign(ForeignConfigDeclStruct.make(input), input);
};

export const ForeignConfigDecl = Object.assign(factory, {
  Struct: ForeignConfigDeclStruct,
  is: Schema.is(ForeignConfigDeclStruct),
});
