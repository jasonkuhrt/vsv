# vsv TODOs

## Deferred oxlint rules

The v1 oxlint plugin ships with only two rules:

- `no-unregistered-command`
- `no-unregistered-context-key`

The following rules are deferred to future iterations. Each tests a real class
of VSCode-extension bug that cannot be caught by the type system alone:

- `dispose-disposable` — flag `Disposable` values that are neither pushed onto
  `context.subscriptions` nor returned from `activate()`, leaking on
  deactivate.
- `activation-events-cover-commands` — every `contributes.commands[].command`
  must have a matching `activationEvents` entry (or be covered by
  `onStartupFinished`).
- `config-key-matches-manifest` — any string passed to
  `workspace.getConfiguration(...).get(key)` must exist in
  `manifest.config[].key`.
- `external-command-needs-dependency` — commands declared via
  `ExternalCommandDecl` must have their source extension listed in
  `manifest.extensionDependencies`.

## Built-in catalogs

`src/lib/builtin-catalog/commands.ts` and `context-keys.ts` are currently empty
placeholders. They should be populated from VSCode's own source:

- Commands: walk `microsoft/vscode/src/vs/workbench/...` for
  `CommandsRegistry.registerCommand(...)` call sites.
- Context keys: walk for `RawContextKey` instantiations (e.g.
  `editorFocus`, `filesExplorerFocus`, etc.).

Consumers of vsv automatically pick up whatever these catalogs export, so
populating them retroactively is a pure enhancement.

## Loader hook empirical verification

The generated `bootstrap.{cjs,mjs}` files use `tsx` to register a TypeScript
loader hook. This needs to be tested end-to-end in a real VSCode extension
development host to verify that:

1. The `tsx/esm` hook successfully strips types from consumer source at
   activation time.
2. Source maps line up so breakpoints work in the Debug extension host.
3. VSCode's own reload cycle does not confuse the loader.

Until verified, the bootstrap generator is a best-effort implementation based
on `tsx`'s documented API.

## Consumer test preload

Because `mock.module('vscode', ...)` must be registered before any static
import of `'vscode'` resolves, consumer tests need the mock installed via
Bun's preload hook rather than a top-level `installVSCodeMock()` call. The
preload file is shipped at
`@jasonkuhrt/vsv/runtime/test/preload` — consumers add this to their
`bunfig.toml`:

```toml
[test]
preload = ["@jasonkuhrt/vsv/runtime/test/preload"]
```

Once preload is in place, consumer tests can call `installVSCodeMock()` at
the top of each test file to get the inspection handle, and `reset()` in
`beforeEach`.

## Surface coverage gaps (forcing-function inventory)

Every place a consumer extension currently reaches past vsv to raw `vscode.*`
is a gap in vsv's surface. The list below is sourced from `vscode-utils` and
`vscode-explorer-delete` and is the priority queue for consumer-driven
expansion. Each gap is a real call site in working code, not a theoretical
completeness target.

When closing a gap: add the typed primitive, JSDoc it, test against the
mock, regenerate consumers, delete the raw `vscode.*` reach.

### Foreign command typing — `ExternalCommandRegistry` threading

The largest single gap. `ExternalCommandDecl` is currently doc-only because
`createRuntime`'s typed `executeCommand` indexes only `CommandRegistry`, not
`ExternalCommandRegistry`. Every foreign command call goes through raw
`vscode.commands.executeCommand(...)` with manual casts. Real call sites in
consumers:

- `revealInExplorer`
- `list.expand`, `list.collapse`, `list.collapseAll`, `list.toggleExpand`,
  `list.focusDown`, `list.focusUp`, `list.focusFirst`, `list.focusParent`
- `workbench.files.action.collapseExplorerFolders`
- `workbench.files.action.focusFilesExplorer`
- `copyFilePath`, `copyRelativeFilePath`
- `moveFileToTrash`
- `vscode.executeDocumentRenameProvider`
- `setContext`

Design question: thread `ExternalCommandRegistry` as a 6th generic on
`Runtime`, or split off `executeExternalCommand` as a separate typed method?
Whichever route, populate the `built-in-catalog/commands.ts` (currently
empty) so consumers don't redeclare the long tail.

### Foreign configuration

`defineConfig` re-contributes the key into `package.json.contributes
.configuration`, which is wrong for settings the extension reads/writes but
doesn't own (e.g. `editor.codeLens`, `problems.visibility`,
`explorer.confirmDelete`). Consumers fall back to raw
`vscode.workspace.getConfiguration(section).get/update/inspect` with manual
casts.

Need: a sibling primitive (e.g. `defineForeignConfig` or
`useExternalConfig`) that gives a typed accessor without the manifest
contribution. Should be backed by a `ForeignConfigDecl` in the manifest so
the type lives there, not at the call site.

### Notifications + status bar — RESOLVED 2026-04-27

Closed by `rt.notify.{info, warn, error, prompt}` and `rt.statusBar.message`.
All 19 call sites in `vscode-utils` migrated. See commit history.

**Still deferred:** persistent status bar items (priority, alignment,
command binding) — not yet needed by any consumer. Land when first consumer
asks.

### Editor + document surface — RESOLVED 2026-04-27

Closed by `rt.editor.active` and `rt.tabs.{groups, close}`. Tab/TabGroup/
TextEditor/TextDocument/Position/Range types re-exported from
`@jasonkuhrt/vsv/runtime`. Consumer `editor.selection.active`,
`editor.document.*`, etc., flow through the re-exported `TextEditor` type
unchanged.

### Workspace edits — RESOLVED 2026-04-27

Closed by `rt.workspace.applyEdit(edit)` + `WorkspaceEdit` value re-export
(plus `Range`, `Position`). Consumers construct `new WorkspaceEdit()`
imported from `@jasonkuhrt/vsv/runtime` and apply via `rt.workspace.applyEdit`.

### Filesystem primitives — RESOLVED 2026-04-27

Closed by `rt.fs.{readDirectory, stat}` and
`rt.workspace.openTextDocument(target)`. `FileType` value enum re-exported
from `@jasonkuhrt/vsv/runtime`; `FileStat` and `TextDocument` types
re-exported. Mock surface added to vscode-mock for fs operations
(`__state.setFsDirectory`, `setFsStat`).

**Still deferred:** typed errors. `vscode.FileSystemError` instances are
thrown raw; consumers still `try/catch` and discard the error type. Worth
landing if a consumer needs to disambiguate (e.g. permission denied vs
file not found).

### Workspace folders — RESOLVED 2026-04-27

Closed by `rt.workspace.folders` accessor + `rt.workspace.onDidChangeFolders`
event subscription. `WorkspaceFolder` type re-exported. Mock surface added
via `__state.setWorkspaceFolders`.

### URI construction + introspection — RESOLVED 2026-04-27

Closed by `Uri` value+type re-export from `@jasonkuhrt/vsv/runtime`. Static
methods (`Uri.file`, `Uri.parse`, `Uri.joinPath`) work identically.
Discoverable via tab-completion on `@jasonkuhrt/vsv/runtime` import.

`ConfigurationTarget` enum re-exported alongside Uri while we were there.

### Clipboard — RESOLVED 2026-04-27

Closed by `rt.clipboard.{readText, writeText}`. Mock surface added via
`__state.{getClipboard, setClipboard}` and a working `vscode.env.clipboard`
mock. Consumer's clipboard-roundtrip pattern (snapshot → write sentinel →
invoke command → read → restore) now flows entirely through `rt.clipboard.*`.

### ExtensionContext + Disposable shape

`Disposable` is re-exported by `runtime` already, but `ExtensionContext` is
not — consumers import the type directly from `vscode`. The surface area
inside `ExtensionContext` (`subscriptions`, `globalState`, `workspaceState`,
`extensionPath`, `secrets`, etc.) is partially covered by `defineState` but
the type itself isn't shielded. Consumers shouldn't need to know
`vscode.ExtensionContext` exists — `activate(ctx: vsv.ActivationContext)`
should be the entry signature.

### Build-pipeline gap (not surface)

`bun run build` runs `build:clean` (`rm -rf build`) then `tsgo` rebuild.
`tsgo` emits `build/exports/cli.js` without the executable bit set, so the
`bin` entry in `package.json` is unusable until manually `chmod +x`. Either
add a `postbuild` step that restores the bit, or change the bin entry to a
wrapper script that doesn't require the +x bit on the emitted file.
