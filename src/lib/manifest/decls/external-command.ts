import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/**
 * Structural schema. Authors construct via the `ExternalCommandDecl(...)`
 * factory, which captures the generic schema types for `args` and `result`.
 */
export class ExternalCommandDeclStruct extends Schema.TaggedClass<ExternalCommandDeclStruct>()(
  'ExternalCommandDecl',
  {
    id: Schema.NonEmptyTrimmedString,
    args: AnySchema,
    result: AnySchema,
    fromExtension: Schema.optional(Schema.String),
  },
) {}

/** Typed authoring shape with the args/result schemas preserved. */
export type ExternalCommandDecl<
  A extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  R extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  Id extends string = string,
> = Omit<ExternalCommandDeclStruct, 'id' | 'args' | 'result'> & {
  readonly id: Id
  readonly args: A
  readonly result: R
}

/**
 * Declares a command **provided by VS Code core or another extension**
 * that this extension wants to call type-safely. Adds the id to the
 * generated `ExternalCommandRegistry` and types `executeExternalCommand`
 * with the args/result captured here.
 *
 * Fields
 * ------
 * - `id` — the foreign command id (e.g. `vscode.executeDocumentRenameProvider`).
 * - `args` — Effect Schema describing the argument shape for the foreign
 *   command.
 * - `result` — Effect Schema describing the foreign command's return
 *   type.
 * - `fromExtension` — optional publisher.extensionName for documentation.
 */
const factory = <
  A extends Schema.Schema.AnyNoContext,
  R extends Schema.Schema.AnyNoContext,
  const Id extends string,
>(spec: {
  readonly id: Id
  readonly args: A
  readonly result: R
  readonly fromExtension?: string
}): ExternalCommandDecl<A, R, Id> => {
  const struct = ExternalCommandDeclStruct.make({
    id: spec.id,
    args: spec.args,
    result: spec.result,
    ...(spec.fromExtension !== undefined ? { fromExtension: spec.fromExtension } : {}),
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- factory captures A, R, and the id literal Id on the returned value
  return struct as ExternalCommandDecl<A, R, Id>
}

export const ExternalCommandDecl = Object.assign(factory, {
  Struct: ExternalCommandDeclStruct,
  is: Schema.is(ExternalCommandDeclStruct),
})
