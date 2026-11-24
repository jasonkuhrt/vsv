import { Schema } from 'effect';
import { AnySchema } from '#lib/schema/any-schema';
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';

/**
 * @description Structural schema. Authors construct via the
 * `ExternalCommandDecl(...)` factory, which captures the generic schema types
 * for `args` and `result`.
 */
export class ExternalCommandDeclStruct extends Schema.TaggedClass<
  ExternalCommandDeclStruct,
  {}
>()('ExternalCommandDecl', {
  id: NonEmptyTrimmedString,
  args: AnySchema,
  result: AnySchema,
  fromExtension: Schema.optional(Schema.String),
}) {}

/**
 * @description Typed authoring shape with the args/result schemas preserved.
 */
export type ExternalCommandDecl<
  A extends Schema.ConstraintCodec<unknown, unknown> = Schema.ConstraintCodec<
    unknown,
    unknown
  >,
  R extends Schema.ConstraintCodec<unknown, unknown> = Schema.ConstraintCodec<
    unknown,
    unknown
  >,
  Id extends string = string,
> = Omit<ExternalCommandDeclStruct, 'id' | 'args' | 'result'> & {
  readonly id: Id;
  readonly args: A;
  readonly result: R;
};

/**
 * @description Declares a command **provided by VS Code core or another
 * extension** that this extension wants to call type-safely. Adds the id to the
 * generated `ExternalCommandRegistry` and types `executeExternalCommand` with
 * the args/result captured here.
 *
 * ## Fields
 *
 * - `id` — the foreign command id (e.g. `vscode.executeDocumentRenameProvider`).
 * - `args` — Effect Schema describing the argument shape for the foreign command.
 * - `result` — Effect Schema describing the foreign command's return type.
 * - `fromExtension` — optional publisher.extensionName for documentation.
 */
const factory = <
  A extends Schema.ConstraintCodec<unknown, unknown>,
  R extends Schema.ConstraintCodec<unknown, unknown>,
  const Id extends string,
>(spec: {
  readonly id: Id;
  readonly args: A;
  readonly result: R;
  readonly fromExtension?: string;
}): ExternalCommandDecl<A, R, Id> => {
  const input = {
    id: spec.id,
    args: spec.args,
    result: spec.result,
    ...(spec.fromExtension === undefined
      ? {}
      : { fromExtension: spec.fromExtension }),
  };
  return Object.assign(ExternalCommandDeclStruct.make(input), input);
};

export const ExternalCommandDecl = Object.assign(factory, {
  Struct: ExternalCommandDeclStruct,
  is: Schema.is(ExternalCommandDeclStruct),
});
