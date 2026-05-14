import { Schema } from 'effect'
import { AnySchema } from '#lib/schema/any-schema'

/**
 * Structural schema — what serialization, codegen, and the IR see. The
 * `args` and `result` fields are validated as Schema-typed at runtime but
 * carry no type information at the type level. Authors construct via the
 * `CommandDecl(...)` factory, which captures the generic schema types.
 */
export class CommandDeclStruct extends Schema.TaggedClass<CommandDeclStruct>()('CommandDecl', {
  id: Schema.NonEmptyTrimmedString,
  args: AnySchema,
  result: AnySchema,
  title: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
}) {}

/**
 * Typed authoring shape. Structurally satisfies `CommandDeclStruct` but
 * carries the `args` and `result` schemas at the type level so downstream
 * runtime/builder code can recover their decoded TypeScript types.
 */
export type CommandDecl<
  A extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
  R extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> = Omit<CommandDeclStruct, 'args' | 'result'> & {
  readonly args: A
  readonly result: R
}

/**
 * Typed factory + namespace. Callable like a constructor; statics give
 * access to the structural schema and runtime guard.
 *
 *   const cmd = CommandDecl({ id: 'ext.do', args: Schema.Void, result: Schema.Void })
 *   CommandDecl.Struct                // Schema for codegen/serialization
 *   CommandDecl.is(x)                 // unknown → x is CommandDeclStruct
 *
 * Declares a command **owned by this extension** — exposed to the Command
 * Palette, callable via keybindings, and registered at runtime through
 * `runtime.defineCommand`. Use `ExternalCommandDecl` for commands provided
 * by VS Code core or other extensions.
 *
 * Fields
 * ------
 * - `id` — fully qualified command id (e.g. `myExt.doThing`). Must be
 *   unique within the extension.
 * - `args` — Effect Schema describing the handler's argument shape. Use
 *   `Schema.Void` for argument-less commands.
 * - `result` — Effect Schema describing the handler's return type. Most
 *   commands return `Schema.Void`; commands queryable via `executeCommand`
 *   should declare meaningful result schemas.
 * - `title` — user-visible label shown in the Command Palette and quick
 *   pickers.
 * - `category` — Command Palette grouping (rendered as `Category: Title`).
 */
const factory = <A extends Schema.Schema.AnyNoContext, R extends Schema.Schema.AnyNoContext>(spec: {
  readonly id: string
  readonly args: A
  readonly result: R
  readonly title?: string
  readonly category?: string
}): CommandDecl<A, R> => {
  const struct = CommandDeclStruct.make({
    id: spec.id,
    args: spec.args,
    result: spec.result,
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    ...(spec.category !== undefined ? { category: spec.category } : {}),
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- factory captures A,R on the returned value; structural class erases them
  return struct as CommandDecl<A, R>
}

export const CommandDecl = Object.assign(factory, {
  Struct: CommandDeclStruct,
  is: Schema.is(CommandDeclStruct),
})
