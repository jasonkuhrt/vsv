# vsv Migrations Index

Each entry documents a real consumer extension migrated from raw `vscode.commands.registerCommand` / hand-rolled mocks onto vsv's typed primitives. Pairs of `## <ext-name>` plus `Migrated`, `Commit`, `Rollback tag`, `Commands migrated`, `Context keys migrated`, `Notes`. Append, don't reorder.

## explorer-delete

- **Migrated:** 2026-04-25
- **Commit:** `1589845`
- **Rollback tag:** `pre-vsv-explorer-delete`
- **Commands migrated:** `explorerDelete.confirmTrash`, `explorerDelete.forceTrash`
- **Context keys migrated:** _(none — extension has no context keys)_
- **External commands declared:** `moveFileToTrash` (still invoked via raw `vscode.commands.executeCommand` — runtime has no typed `executeExternalCommand`)
- **Notes:**
  - Pre-existing repo state was non-git; `git init` + initial commit + tag was needed for the rollback invariant.
  - `explorer.confirmDelete` is a built-in VSCode setting (not extension-contributed). Kept on raw `vscode.workspace.getConfiguration` rather than `rt.defineConfig` (which would re-contribute the key).
  - Mock gap (since resolved): originally only had a smoke test because `WorkspaceConfiguration.inspect()` was missing; the mock was expanded with per-target inspect/update support and behavioral tests cover the flip-confirm-restore flow including the error-recovery `finally` block.
  - See `vscode-explorer-delete/DEVIATIONS.md` for the full per-phase log.

## utils

- **Migrated:** 2026-04-25
- **Commit:** `f849b85`
- **Rollback tag:** `pre-vsv-utils`
- **Commands migrated:** `jason.toggleCodeLens`, `jason.toggleProblemsVisibility`, `jason.closeUnpinnedTabs`, `jason.renameTight`
- **Context keys migrated:** _(none)_
- **External commands declared:** `vscode.executeDocumentRenameProvider` (still raw-called; same runtime gap)
- **Notes:**
  - Pre-existing repo state was non-git; same `git init` + tag pattern.
  - All four toggle/close/rename commands operate on built-in VSCode settings or built-in workspace surfaces, not extension-contributed config — `rt.defineConfig` would mis-contribute keys.
  - Mock gap (since resolved): originally only had a smoke test because the entire editor + workspace-edit + tabGroups + setStatusBarMessage surface was missing. The mock was expanded; the regex-driven alias-strip is now covered end-to-end with a test that simulates tsserver's `bar as foo` specifier emit and asserts the strip pass cleans it up.
  - `eslint/no-await-in-loop` disabled for this extension: `stripAliasesInFiles` is intentionally sequential for failure isolation. See DEVIATIONS for the rationale.
  - See `vscode-utils/DEVIATIONS.md` for the full per-phase log.

## workbench-cycler

- **Migrated:** 2026-04-27
- **Commit:** `3c681d3` (publisher fix; the manifest scaffolding predates this entry)
- **Rollback tag:** _(none — extension was already on vsv before MIGRATIONS.md was created)_
- **Commands migrated:** `workbenchCycler.applyPreset`, `workbenchCycler.nextInSequence`
- **Context keys migrated:** `workbenchCycler.currentPreset`
- **External commands declared:** _(none — 12 raw `vscode.commands.executeCommand` calls into VSCode core remain pending typed external command support; see `TODO.md` gap #1)_
- **Notes:**
  - Already on vsv when this index was authored — was retroactively documented after a publisher gap surfaced.
  - The original manifest omitted `publisher`, so VSCode registered the extension as `undefined_publisher.workbench-cycler`. Fixed by declaring `publisher: 'jasonkuhrt'` + explicit `version` in `vsv.manifest.ts`.
  - First consumer to exercise `defineContextKey` end-to-end — the `workbenchCycler.currentPreset` key is read in keybindings to discriminate the next-in-sequence direction (forward/reverse via two binding entries).
  - First consumer to use `Schema.Array(...)` in a command arg schema. After the upstream fix to `schemaToTs`, the generated `sequence` parameter type tightened from mutable `Array<...>` to `ReadonlyArray<...>`. The consumer was already treating the array as readonly; no call-site changes.
  - Probes 12 VSCode core commands not yet declared in any extension's manifest (`workbench.action.{closePanel, toggleMaximizedAuxiliaryBar, closeSidebar, terminal.focus, closeAuxiliaryBar}`, `workbench.files.action.focusFilesExplorer`). When `executeExternalCommand` lands (gap #1), this is the highest-volume consumer of foreign commands and the natural seed for `built-in-catalog/commands.ts`.

---

## Cross-cutting follow-ups for vsv

### Resolved

Items 2–5 of the original list — all the test-mock gaps — were resolved in the same session that introduced these migrations. The mock now covers the surfaces real extensions reach for. See `src/lib/runtime-test/tests/vscode-mock-extended.test.ts` for the new behavioral coverage and `src/lib/runtime-test/vscode-mock.ts` for the extended surface (`Position`, `Range`, `Selection`, `Uri`, `WorkspaceEdit`, `TextDocument`, `setStatusBarMessage`, `tabGroups`, `activeTextEditor`, `showInputBox`, `openTextDocument`, `applyEdit`, `inspect()`, per-target config storage).

### Resolved (continued)

**Typed external command execution — RESOLVED 2026-04-28.** Added `EXR extends ExternalCommandRegistryShape` as a 6th generic on `Runtime` and `createRuntime`, plus a typed `executeExternalCommand<Id, R>(id, ...args)` method. Args declared as `Schema.Tuple(...)` in the manifest are spread positionally into VSCode's variadic `commands.executeCommand(id, ...args)` call. The optional second generic `R` lets callers pin opaque vscode runtime types (`WorkspaceEdit | undefined`, etc.) that can't be expressed as Schema. All 14 `vscode.commands.executeCommand(...)` call sites in `vscode-utils` and the 1 in `vscode-explorer-delete` have been migrated. Zero raw call sites remain in either consumer. `workbench-cycler` still has 12 raw calls — separate migration (see `TODO.md`).

### Resolved (continued)

**`defineConfig` for foreign vscode settings — RESOLVED 2026-04-28.** Added `ForeignConfigDecl` to the manifest schema and `defineForeignConfig` to `Runtime` (FCR is the 7th generic on `Runtime` and `createRuntime`). Foreign configs are NOT synced into `package.json#contributes.configuration` — codegen tests guard the boundary. Also added `inspect()` to `ConfigHandle` (used for the snapshot/mutate/restore pattern in `vscode-explorer-delete`'s confirm-toggle), and changed `update`'s value parameter to `V | undefined` so passing the original `undefined` correctly clears a slot. `explorer.confirmDelete`, `editor.codeLens`, and `problems.visibility` migrated to `rt.defineForeignConfig` in both consumer extensions; zero raw `vscode.workspace.getConfiguration` calls remain.

### Open

1. **Document boundary semantics.** `getWordRangeAtPosition` in the mock matches positions inclusive on both ends (`start <= pos <= end`). VSCode's actual implementation uses inclusive-end too via 1-indexed columns; verify alignment if any consumer code hits the boundary case.
