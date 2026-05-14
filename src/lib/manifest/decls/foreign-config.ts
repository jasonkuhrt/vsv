import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/** Structural schema. */
export class ForeignConfigDeclStruct extends Schema.TaggedClass<ForeignConfigDeclStruct>()(
  'ForeignConfigDecl',
  {
    fullKey: Schema.NonEmptyTrimmedString,
    valueSchema: AnySchema,
    ownedBy: Schema.optional(Schema.String),
  },
) {}

/** Typed authoring shape with the value schema preserved. */
export type ForeignConfigDecl<
  V extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  K extends string = string,
> = Omit<ForeignConfigDeclStruct, 'fullKey' | 'valueSchema'> & {
  readonly fullKey: K
  readonly valueSchema: V
}

/**
 * Declares a configuration setting **owned by VS Code core or another
 * extension** that this extension reads/writes but does not contribute.
 * Adds the key to the generated `ForeignConfigRegistry` and gives a
 * typed accessor via `runtime.defineForeignConfig(fullKey)`. **Not**
 * synced into `package.json#contributes.configuration` — re-contributing
 * a foreign key would corrupt VS Code's settings UI.
 *
 * Fields
 * ------
 * - `fullKey` — the dotted setting path as it appears in `settings.json`
 *   (e.g. `editor.codeLens`, `explorer.confirmDelete`).
 * - `valueSchema` — Effect Schema describing the value type. Drives the
 *   typed accessor returned by `defineForeignConfig`.
 * - `ownedBy` — optional documentation note ("vscode core", "publisher.ext").
 */
const factory = <V extends Schema.Schema.AnyNoContext, const K extends string>(spec: {
  readonly fullKey: K
  readonly valueSchema: V
  readonly ownedBy?: string
}): ForeignConfigDecl<V, K> => {
  const struct = ForeignConfigDeclStruct.make({
    fullKey: spec.fullKey,
    valueSchema: spec.valueSchema,
    ...(spec.ownedBy !== undefined ? { ownedBy: spec.ownedBy } : {}),
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- factory captures V and the fullKey literal K
  return struct as ForeignConfigDecl<V, K>
}

export const ForeignConfigDecl = Object.assign(factory, {
  Struct: ForeignConfigDeclStruct,
  is: Schema.is(ForeignConfigDeclStruct),
})
