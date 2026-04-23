import { Schema } from 'effect'

export class CommandDecl extends Schema.TaggedClass<CommandDecl>()('CommandDecl', {
  id: Schema.NonEmptyTrimmedString,
  args: Schema.Unknown,
  result: Schema.Unknown,
  title: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
}) {}

export class ExternalCommandDecl extends Schema.TaggedClass<ExternalCommandDecl>()(
  'ExternalCommandDecl',
  {
    id: Schema.NonEmptyTrimmedString,
    args: Schema.Unknown,
    result: Schema.Unknown,
    fromExtension: Schema.optional(Schema.String),
  },
) {}

export class ContextKeyDecl extends Schema.TaggedClass<ContextKeyDecl>()('ContextKeyDecl', {
  name: Schema.NonEmptyTrimmedString,
  valueType: Schema.Unknown,
  defaultValue: Schema.optional(Schema.Unknown),
}) {}

export class ConfigDecl extends Schema.TaggedClass<ConfigDecl>()('ConfigDecl', {
  key: Schema.NonEmptyTrimmedString,
  valueSchema: Schema.Unknown,
  description: Schema.optional(Schema.String),
}) {}

export class StateDecl extends Schema.TaggedClass<StateDecl>()('StateDecl', {
  key: Schema.NonEmptyTrimmedString,
  scope: Schema.Literal('global', 'workspace'),
  valueSchema: Schema.Unknown,
}) {}

export class Manifest extends Schema.TaggedClass<Manifest>()('Manifest', {
  name: Schema.NonEmptyTrimmedString,
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  publisher: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  engineVscode: Schema.optional(Schema.String),
  activationEvents: Schema.optional(Schema.Array(Schema.String)),
  extensionDependencies: Schema.optional(Schema.Array(Schema.String)),
  commands: Schema.optional(Schema.Array(CommandDecl)),
  externalCommands: Schema.optional(Schema.Array(ExternalCommandDecl)),
  contextKeys: Schema.optional(Schema.Array(ContextKeyDecl)),
  config: Schema.optional(Schema.Array(ConfigDecl)),
  state: Schema.optional(Schema.Array(StateDecl)),
}) {}
