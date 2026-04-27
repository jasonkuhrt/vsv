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

---

## Cross-cutting follow-ups for vsv

### Resolved

Items 2–5 of the original list — all the test-mock gaps — were resolved in the same session that introduced these migrations. The mock now covers the surfaces real extensions reach for. See `src/lib/runtime-test/tests/vscode-mock-extended.test.ts` for the new behavioral coverage and `src/lib/runtime-test/vscode-mock.ts` for the extended surface (`Position`, `Range`, `Selection`, `Uri`, `WorkspaceEdit`, `TextDocument`, `setStatusBarMessage`, `tabGroups`, `activeTextEditor`, `showInputBox`, `openTextDocument`, `applyEdit`, `inspect()`, per-target config storage).

### Open

1. **Typed external command execution.** `ExternalCommandDecl` exists in the manifest schema and emits an `ExternalCommandRegistry` type, but the `Runtime` interface's `executeCommand` is typed only against `CommandRegistry`. Both consumer extensions had to fall back to `vscode.commands.executeCommand(...)` directly. Add `executeExternalCommand<Id extends keyof EXR>(id, args)` to `Runtime`, parameterized on a separate `EXR extends ExternalCommandRegistryShape` generic of `createRuntime`. This keeps `defineCommand` narrow to internal commands.

2. **`defineConfig` for foreign vscode settings.** Both consumer extensions read/write built-in VSCode settings (`explorer.confirmDelete`, `editor.codeLens`, `problems.visibility`). `defineConfig` is currently scoped to extension-contributed settings — using it for foreign settings would (incorrectly) re-contribute the key in `package.json.contributes.configuration`. Either: (a) add a separate `defineForeignConfig(section, key, valueType)` that doesn't touch the manifest, or (b) document this is the right boundary and `vscode.workspace.getConfiguration` directly is correct. The migrations took option (b) by default.

3. **Document boundary semantics.** `getWordRangeAtPosition` in the mock matches positions inclusive on both ends (`start <= pos <= end`). VSCode's actual implementation uses inclusive-end too via 1-indexed columns; verify alignment if any consumer code hits the boundary case.
