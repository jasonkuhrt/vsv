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

### Editor + document surface

- `vscode.window.activeTextEditor`
- `vscode.window.tabGroups.all`, `vscode.window.tabGroups.close`
- `Tab.isPinned` predicate
- `editor.selection.active`, `editor.document.getWordRangeAtPosition`,
  `editor.document.getText(range)`
- `editor.document.uri`, `editor.document.lineCount`,
  `editor.document.lineAt(n).range.end`

Need: a typed `editor` accessor that returns `undefined` when no editor is
active, plus a `tabs` accessor over groups. Position/Range/Selection should
be vsv value types (re-exported with JSDoc, or thin wrappers).

### Workspace edits

- `vscode.WorkspaceEdit` constructor + `wsEdit.replace(uri, range, text)`
- `vscode.workspace.applyEdit(edit)`

Need: a `WorkspaceEdit` builder primitive. The current ergonomics force the
caller to know that `applyEdit` exists at the workspace level, while the
`WorkspaceEdit` is built standalone — that mismatch is a footgun.

### Filesystem primitives

- `vscode.workspace.fs.readDirectory(uri)`
- `vscode.workspace.fs.stat(uri)`
- `vscode.workspace.openTextDocument(uri)`

Need: a `fs` namespace mirroring `vscode.workspace.fs`, ideally returning
typed errors (currently consumers wrap in `try/catch` and discard error
type). `FileType.Directory` etc. should be re-exported as a typed enum.

### Workspace folders

- `vscode.workspace.workspaceFolders` — every dig command in
  `vscode-utils` reads this on entry.

Need: a typed accessor with sensible undefined handling, plus
`onDidChangeWorkspaceFolders` lifecycle integration.

### URI construction + introspection

- `vscode.Uri.file(fsPath)`
- `vscode.Uri.parse(uriStr)`
- `vscode.Uri.joinPath(parent, child)`
- `uri.fsPath`, `uri.scheme`

Need: thin re-export with JSDoc. The current types are fine; the
discoverability isn't.

### Clipboard

- `vscode.env.clipboard.readText()`
- `vscode.env.clipboard.writeText(s)`

Need: a `clipboard` namespace. Trivial, but two call sites in
`vscode-utils` already.

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
