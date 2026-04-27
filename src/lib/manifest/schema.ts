import { Schema } from 'effect'

/**
 * Declares a command **owned by this extension** — exposed to the Command
 * Palette, callable via keybindings, and registered at runtime through
 * `runtime.defineCommand`. Each declaration here becomes one entry in the
 * generated `CommandRegistry`, which then types the runtime's `defineCommand`
 * and `executeCommand` calls.
 *
 * Use `ExternalCommandDecl` instead for commands provided by VS Code core or
 * other extensions — those describe pre-existing IDs, not new contributions.
 *
 * Fields
 * ------
 * - `id` — fully qualified command id (e.g. `myExt.doThing`). Becomes a key
 *   in `CommandRegistry`. Must be unique within the extension.
 * - `args` — Effect Schema describing the handler's argument shape. Use
 *   `Schema.Void` for argument-less commands. The schema's TypeScript type
 *   is extracted into `CommandRegistry[id].args` and constrains the handler
 *   signature.
 * - `result` — Effect Schema describing the handler's return type. Most
 *   commands return `Schema.Void`; commands queryable via `executeCommand`
 *   should declare meaningful result schemas.
 * - `title` — user-visible label shown in the Command Palette and quick
 *   pickers. Optional, but recommended for any command users invoke directly.
 * - `category` — Command Palette grouping (rendered as `Category: Title`).
 *   Optional.
 */
export class CommandDecl extends Schema.TaggedClass<CommandDecl>()('CommandDecl', {
  id: Schema.NonEmptyTrimmedString,
  args: Schema.Unknown,
  result: Schema.Unknown,
  title: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
}) {}

/**
 * Declares a command **provided by VS Code core or another extension** that
 * this extension wants to call type-safely. Adds the id to the generated
 * `ExternalCommandRegistry` for documentation and codegen purposes.
 *
 * Note: at the time of writing, the runtime's typed `executeCommand` only
 * indexes `CommandRegistry`, not `ExternalCommandRegistry`. Calls to external
 * commands still go through `vscode.commands.executeCommand(...)` directly
 * with a manual cast — the registry is currently doc-only. See consumer
 * DEVIATIONS notes for the rationale.
 *
 * Fields
 * ------
 * - `id` — the foreign command id (e.g. `vscode.executeDocumentRenameProvider`).
 * - `args` — Effect Schema describing the argument shape for the foreign
 *   command. Often `Schema.Unknown` when the foreign API isn't precisely
 *   modeled.
 * - `result` — Effect Schema describing the foreign command's return type.
 * - `fromExtension` — optional publisher.extensionName for documentation
 *   when the command originates from a third-party extension.
 */
export class ExternalCommandDecl extends Schema.TaggedClass<ExternalCommandDecl>()(
  'ExternalCommandDecl',
  {
    id: Schema.NonEmptyTrimmedString,
    args: Schema.Unknown,
    result: Schema.Unknown,
    fromExtension: Schema.optional(Schema.String),
  },
) {}

/**
 * Declares a context key — a named runtime flag VS Code can branch on inside
 * `when` clauses for keybindings, menus, and view visibility. Set via
 * `runtime.defineContextKey(name).set(value)`.
 *
 * The generated `ContextKeyRegistry` types the value across `set/get/onChange`
 * for the matching key.
 *
 * Fields
 * ------
 * - `name` — the context key name as referenced in `when` clauses. Convention:
 *   camelCase (`myExt.featureEnabled`).
 * - `valueType` — Effect Schema describing the value type. Typically
 *   `Schema.Boolean`, `Schema.String`, or a literal union.
 * - `defaultValue` — optional initial value seeded when the runtime first
 *   defines the key.
 */
export class ContextKeyDecl extends Schema.TaggedClass<ContextKeyDecl>()('ContextKeyDecl', {
  name: Schema.NonEmptyTrimmedString,
  valueType: Schema.Unknown,
  defaultValue: Schema.optional(Schema.Unknown),
}) {}

/**
 * Declares a configuration setting **contributed by this extension** —
 * surfaced in `package.json` under `contributes.configuration` and accessed
 * via `runtime.defineConfig(key)`.
 *
 * Use this only for settings the extension itself owns. To read or write
 * settings that already exist in VS Code or another extension (e.g.
 * `editor.codeLens`, `explorer.confirmDelete`), call
 * `vscode.workspace.getConfiguration(...)` directly — declaring foreign keys
 * would re-contribute them and produce a misleading settings UI.
 *
 * Fields
 * ------
 * - `key` — the setting key (e.g. `myExt.feature.threshold`).
 * - `valueSchema` — Effect Schema describing the setting's value type. Drives
 *   both runtime typing and the generated configuration contribution.
 * - `description` — user-facing description shown in VS Code's settings UI.
 */
export class ConfigDecl extends Schema.TaggedClass<ConfigDecl>()('ConfigDecl', {
  key: Schema.NonEmptyTrimmedString,
  valueSchema: Schema.Unknown,
  description: Schema.optional(Schema.String),
}) {}

/**
 * Declares persistent state — a key-value entry backed by VS Code's
 * `globalState` (machine-wide) or `workspaceState` (per-workspace) memento.
 * Accessed at runtime via `runtime.defineState(ctx, key, scope)`.
 *
 * Use this for state that must survive extension reloads or workspace
 * re-opens. For ephemeral in-memory state, plain module variables are
 * lighter and don't require manifest churn.
 *
 * Fields
 * ------
 * - `key` — the storage key. Namespace explicitly (e.g. `myExt.featureLastRun`)
 *   since global state shares one keyspace across extensions.
 * - `scope` — `'global'` (sync via VS Code Settings Sync if enabled,
 *   machine-wide) or `'workspace'` (local to the current workspace).
 * - `valueSchema` — Effect Schema describing the stored value type. The
 *   memento serializes via `JSON.stringify`, so the schema must describe a
 *   JSON-serializable shape.
 */
export class StateDecl extends Schema.TaggedClass<StateDecl>()('StateDecl', {
  key: Schema.NonEmptyTrimmedString,
  scope: Schema.Literal('global', 'workspace'),
  valueSchema: Schema.Unknown,
}) {}

/**
 * Top-level extension manifest. Drives both code generation (the
 * `*Registry` types in `src/generated/registries.ts` and `package.json`
 * contribution arrays) and runtime typing.
 *
 * Authored as the default export of `vsv.manifest.ts` via `defineManifest({
 * ... })`; never instantiated directly by extension code.
 *
 * Fields
 * ------
 * - `name` — extension name (matches `package.json#name`).
 * - `displayName`, `description` — user-facing strings shown in the
 *   marketplace and Extensions view.
 * - `publisher` — required. Without it, VSCode registers the extension as
 *   `undefined_publisher.<name>`, which surfaces as a misleading id in the
 *   Extensions view, command logs, and any code that filters by extension id.
 *   Costs nothing to declare; vsv refuses to codegen without it.
 * - `version`, `engineVscode` — standard `package.json` fields, replicated
 *   here so codegen has the values when emitting `package.json`.
 * - `activationEvents` — VS Code activation events (e.g. `'onStartupFinished'`,
 *   `'onCommand:myExt.doThing'`). Empty array means "implicit" activation
 *   based on declared contributions.
 * - `extensionDependencies` — list of `publisher.name` ids this extension
 *   requires VS Code to install/activate first.
 * - `commands`, `externalCommands`, `contextKeys`, `config`, `state` — the
 *   typed contribution arrays, each driving one generated registry. See
 *   each Decl class for per-field guidance.
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
  commands: Schema.optional(Schema.Array(CommandDecl)),
  externalCommands: Schema.optional(Schema.Array(ExternalCommandDecl)),
  contextKeys: Schema.optional(Schema.Array(ContextKeyDecl)),
  config: Schema.optional(Schema.Array(ConfigDecl)),
  state: Schema.optional(Schema.Array(StateDecl)),
}) {}
