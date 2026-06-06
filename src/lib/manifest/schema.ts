// Manifest schema entry point. Re-exports the typed decl namespaces from
// `./decls/*` so existing consumers can `import { CommandDecl, ... } from
// '#lib/manifest/schema'`. The structural `Manifest` TaggedClass below uses
// each decl's `.Struct` for serialization-side schema composition; authoring
// goes through the factory callables (`CommandDecl({ ... })`, etc.).

import { Schema } from 'effect'
import { CommandDecl } from './decls/command.ts'
import { ConfigDecl } from './decls/config.ts'
import { ContextKeyDecl } from './decls/context-key.ts'
import { ExternalCommandDecl } from './decls/external-command.ts'
import { ExternalContextKeyDecl } from './decls/external-context-key.ts'
import { ForeignConfigDecl } from './decls/foreign-config.ts'
import { MenuDecl } from './decls/menu.ts'
import { StateDecl } from './decls/state.ts'

export {
  CommandDecl,
  ConfigDecl,
  ContextKeyDecl,
  ExternalCommandDecl,
  ExternalContextKeyDecl,
  ForeignConfigDecl,
  MenuDecl,
  StateDecl,
}

/**
 * Top-level extension manifest. Drives both code generation (the
 * `*Registry` types in `src/generated/registries.ts` and `package.json`
 * contribution arrays) and runtime typing.
 *
 * Authored as the default export of `vsv.manifest.ts` via
 * `defineManifest({ ... })`; never instantiated directly by extension
 * code.
 *
 * Fields
 * ------
 * - `name` — extension name (matches `package.json#name`).
 * - `displayName`, `description` — user-facing strings shown in the
 *   marketplace and Extensions view.
 * - `publisher` — required. Without it, VS Code registers the extension
 *   as `undefined_publisher.<name>`.
 * - `version`, `engineVscode` — standard `package.json` fields,
 *   replicated here so codegen has the values when emitting `package.json`.
 * - `activationEvents` — VS Code activation events.
 * - `extensionDependencies` — list of `publisher.name` ids this
 *   extension requires VS Code to install/activate first.
 * - `commands`, `externalCommands`, `contextKeys`, `config`,
 *   `foreignConfig`, `menus`, `state` — the typed contribution arrays, each
 *   driving one generated registry or `package.json` contribution. Authored
 *   via the matching `*Decl({ ... })` factory.
 */
export class Manifest extends Schema.TaggedClass<Manifest>()('Manifest', {
  name: Schema.NonEmptyTrimmedString,
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  publisher: Schema.NonEmptyTrimmedString,
  version: Schema.optional(Schema.String),
  engineVscode: Schema.optional(Schema.String),
  activationEvents: Schema.optional(Schema.Array(Schema.String)),
  extensionDependencies: Schema.optional(Schema.Array(Schema.String)),
  commands: Schema.optional(Schema.Array(CommandDecl.Struct)),
  externalCommands: Schema.optional(Schema.Array(ExternalCommandDecl.Struct)),
  contextKeys: Schema.optional(Schema.Array(ContextKeyDecl.Struct)),
  externalContextKeys: Schema.optional(Schema.Array(ExternalContextKeyDecl.Struct)),
  config: Schema.optional(Schema.Array(ConfigDecl.Struct)),
  foreignConfig: Schema.optional(Schema.Array(ForeignConfigDecl.Struct)),
  menus: Schema.optional(Schema.Array(MenuDecl.Struct)),
  state: Schema.optional(Schema.Array(StateDecl.Struct)),
}) {}
