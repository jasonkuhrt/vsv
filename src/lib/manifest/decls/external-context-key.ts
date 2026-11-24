import { Schema } from 'effect';
import { AnySchema } from '#lib/schema/any-schema';
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';

/**
 * @description Structural schema.
 */
export class ExternalContextKeyDeclStruct extends Schema.TaggedClass<
  ExternalContextKeyDeclStruct,
  {}
>()('ExternalContextKeyDecl', {
  name: NonEmptyTrimmedString,
  valueType: AnySchema,
  ownedBy: Schema.optional(Schema.String),
}) {}

/**
 * @description Typed authoring shape with the value schema and name literal
 * preserved.
 */
export type ExternalContextKeyDecl<
  V extends Schema.ConstraintCodec<unknown, unknown> = Schema.ConstraintCodec<
    unknown,
    unknown
  >,
  N extends string = string,
> = Omit<ExternalContextKeyDeclStruct, 'name' | 'valueType'> & {
  readonly name: N;
  readonly valueType: V;
};

/**
 * @description Declares a context key **owned by VS Code core or another
 * extension** that this extension wants to read in `when` clauses. Symmetric to
 * `ExternalCommandDecl` on the command side: registers the key + its value-type
 * Schema for typed consumption without claiming ownership (no
 * `package.json#contributes.*` side effect — re-contributing a key the
 * extension doesn't own would corrupt VS Code's ownership model).
 *
 * Use this when authoring `when` clauses that reference VS Code's built-in
 * context keys (`activeCustomEditorId`, `editorLangId`, etc.) or third-party
 * extensions' context keys.
 *
 * ## Fields
 *
 * - `name` — the context key name as referenced in `when` clauses.
 * - `valueType` — Effect Schema describing the value type. For value-compared
 *   keys, declare the typed value domain (e.g.
 *   `Schema.Literal('vscode.markdown.preview.editor', ...)` for a closed enum).
 *   For boolean keys, `Schema.Boolean`.
 * - `ownedBy` — optional documentation note ("vscode core", "publisher.ext").
 */
const factory = <
  V extends Schema.ConstraintCodec<unknown, unknown>,
  const N extends string,
>(spec: {
  readonly name: N;
  readonly valueType: V;
  readonly ownedBy?: string;
}): ExternalContextKeyDecl<V, N> => {
  const input = {
    name: spec.name,
    valueType: spec.valueType,
    ...(spec.ownedBy === undefined ? {} : { ownedBy: spec.ownedBy }),
  };
  return Object.assign(ExternalContextKeyDeclStruct.make(input), input);
};

export const ExternalContextKeyDecl = Object.assign(factory, {
  Struct: ExternalContextKeyDeclStruct,
  is: Schema.is(ExternalContextKeyDeclStruct),
});
