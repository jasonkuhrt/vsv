import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/** Structural schema. */
export class ExternalContextKeyDeclStruct extends Schema.TaggedClass<ExternalContextKeyDeclStruct>()(
  'ExternalContextKeyDecl',
  {
    name: Schema.NonEmptyTrimmedString,
    valueType: AnySchema,
    ownedBy: Schema.optional(Schema.String),
  },
) {}

/** Typed authoring shape with the value schema and name literal preserved. */
export type ExternalContextKeyDecl<
  V extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  N extends string = string,
> = Omit<ExternalContextKeyDeclStruct, 'name' | 'valueType'> & {
  readonly name: N
  readonly valueType: V
}

/**
 * Declares a context key **owned by VS Code core or another extension**
 * that this extension wants to read in `when` clauses. Symmetric to
 * `ExternalCommandDecl` on the command side: registers the key + its
 * value-type Schema for typed consumption without claiming ownership
 * (no `package.json#contributes.*` side effect — re-contributing a key
 * the extension doesn't own would corrupt VS Code's ownership model).
 *
 * Use this when authoring `when` clauses that reference VS Code's
 * built-in context keys (`activeCustomEditorId`, `editorLangId`, etc.)
 * or third-party extensions' context keys.
 *
 * Fields
 * ------
 * - `name` — the context key name as referenced in `when` clauses.
 * - `valueType` — Effect Schema describing the value type. For
 *   value-compared keys, declare the typed value domain
 *   (e.g. `Schema.Literal('vscode.markdown.preview.editor', ...)` for
 *   a closed enum). For boolean keys, `Schema.Boolean`.
 * - `ownedBy` — optional documentation note ("vscode core",
 *   "publisher.ext").
 */
const factory = <V extends Schema.Schema.AnyNoContext, const N extends string>(spec: {
  readonly name: N
  readonly valueType: V
  readonly ownedBy?: string
}): ExternalContextKeyDecl<V, N> => {
  const struct = ExternalContextKeyDeclStruct.make({
    name: spec.name,
    valueType: spec.valueType,
    ...(spec.ownedBy !== undefined ? { ownedBy: spec.ownedBy } : {}),
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- factory captures V and the name literal N on the returned value
  return struct as ExternalContextKeyDecl<V, N>
}

export const ExternalContextKeyDecl = Object.assign(factory, {
  Struct: ExternalContextKeyDeclStruct,
  is: Schema.is(ExternalContextKeyDeclStruct),
})
