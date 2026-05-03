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

### Resolved (continued)

**Boundary semantics for `getWordRangeAtPosition` — VERIFIED 2026-04-28.** VSCode's `TextModel.getWordAtPosition` treats `column == end-of-word` as inside the word (cursor-just-past-last-char still matches). The mock implements the equivalent (`start <= pos <= end`) and a dedicated test now pins the four boundary positions for `"foo bar"` (positions 0, 3, 4, 7). Documented in `src/lib/runtime-test/tests/vscode-mock-extended.test.ts`.

### Resolved (continued)

**Effect-native runtime — RESOLVED 2026-05-03.** Every Promise-returning method on the runtime now returns `Effect.Effect<A, E>` with a typed error channel. Sync getters and inherently-sync operations (`workspace.updateFolders`, `statusBar.message`, `disposables`, `defineCommand`'s return, `EventHandle.{fire,event,dispose}`, all `*.get`/`*.getWithDefault`/`*.inspect`/`*.onChange` accessors) stay sync. Consumer extensions (`vscode-utils`, `vscode-session`, `vscode-explorer-delete`, `workbench-cycler`) migrate separately — this entry covers the underlying infra only.

**Design choices**

- **`Data.TaggedError` (not `Schema.TaggedError`).** Runtime errors don't need schema validation or parsing; `Data.TaggedError` from `effect` gives a plain class with `_tag` discrimination, integrates with `Effect.catchTag`/`Effect.catchTags`/`Match.tag` exhaustively, and avoids carrying a parser around at runtime. `manifest/schema.ts` continues to use `Schema.TaggedClass` for _data_ types where parsing matters.

- **Error hierarchy: high-signal splits + per-surface catch-alls.** Two failure modes get distinct tags because consumers branch on them routinely (`FileNotFoundError`, `UnsupportedSchemeError`). Everything else collapses into one catch-all per surface (`FsError`, `CommandExecutionError`, `DocumentOpenError`, `WorkspaceEditError`, `ConfigUpdateError`, `StateUpdateError`, `ClipboardError`) carrying the original error on a `cause: unknown` field. `RuntimeError` is exported as a union of every error type for callers spanning multiple surfaces.

- **No backward compatibility for `defineCommand` handlers.** Handlers must return `Effect.Effect<R, E, never>` — no sync or `async`/`await` overload. Per the user's "complete cut" rule (`CLAUDE.md`: "never move now, remodel later"), the alternative would have been a sync overload `(args) => R | Effect<R, ...>`, but a tri-shape handler signature creates inference instability and a permanent backward-compat surface. The runtime bridges to vscode via `Effect.runPromiseExit + Cause.failureOption` (not bare `runPromise`) so the handler's original tagged-error identity survives the round-trip — `executeCommand` callers matching on `CommandExecutionError.cause._tag` see the handler's exact error tag rather than Effect's `FiberFailure` wrapper.

- **`workspace.updateFolders` stays sync.** VSCode's underlying `vscode.workspace.updateWorkspaceFolders` is genuinely synchronous and returns `boolean`. Wrapping in `Effect.sync` would lie about the cost model — there is no async work, no failure channel, no fiber suspension. Callers in `Effect.gen` blocks call it directly without `yield*`. Same rationale for `statusBar.message`, `disposables`, and `EventHandle`'s sync trio.

- **`onChange` callbacks stay callback-shaped, not `Stream<T>`.** The migration is Promise→Effect, not callback→Stream. Reshaping `onChange` would be a bigger redesign with bigger consumer impact; the current callback shape is a thin disposable wrapper around `vscode.EventEmitter`/`onDidChangeConfiguration` that doesn't benefit from Effect typing.

- **`applyEdit` keeps `boolean` in the success channel.** VSCode distinguishes "edit accepted but rolled back due to conflicts" (`Promise<false>`) from "API call itself errored" (rejected). The former is meaningful success-channel data; the latter is `WorkspaceEditError`. Collapsing both into the error channel would lose information.

- **Initial `setContext` in `defineContextKey` stays fire-and-forget.** VSCode updates context state synchronously inside `executeCommand`'s body before the IPC roundtrip resolves, so subsequent reads see the initial value even though the Effect-returning `set` is the only awaited path. The alternative — making `defineContextKey` itself return `Effect<ContextKeyHandle, …>` — adds friction (every caller must `yield*` the construction) for a guarantee VSCode already provides synchronously.

- **`Effect.gen` reserved for genuine multi-step flows.** Single-call wrappers use `Effect.tryPromise`/`Effect.promise` directly — no synthetic gen wrapping. `fs.realpath` could have used `Effect.gen` for its scheme-guard-then-realpath flow but uses an early-return `Effect.fail` for the guard followed by a single `Effect.tryPromise` instead, which reads more clearly than wrapping the whole thing in `gen` for a single yield. The general bias remains: prefer `Effect.gen` when you'd otherwise chain three or more pipe steps.

**Consumer migration: cost coming due (paid)**

The four consumer extensions (`vscode-utils`, `vscode-session`, `vscode-explorer-delete`, `workbench-cycler`) were written against the prior Promise-based runtime. With the runtime change on `main`, every existing `await rt.notify.*`, `await rt.workspace.applyEdit(...)`, `await rt.tabs.close(...)` etc. in those extensions awaited an `Effect`, which resolves to the Effect value itself without ever running it — every command path no-op'd. This was the **cost of the prior shape coming due**, not a regression introduced here: the Promise-based runtime was tech debt accepted earlier, the Effect runtime is the correct shape, and the price of paying that debt was migrating each consumer's call sites. All four extensions migrated in lockstep:

- `vscode-utils`: commit `3ec981b` — 11 files, every handler converted to `Effect.gen`. Bonus: `addResolvedFolderToWorkspace` dropped its prior "raw vscode for showOpenDialog/updateWorkspaceFolders" deviation (those wrappers now exist on `rt.window` / `rt.workspace`) and `fs.realpathSync`/`statSync` calls migrated to `rt.fs.realpath`/`stat` for typed-error branching.
- `vscode-session`: commit `538ed09` — handler converted to `Effect.gen`, eager activation scan + `onDidChangeFolders` callback bridge through `Effect.runPromise` at the sync-vscode-API boundary.
- `vscode-explorer-delete`: commit `c13296b` — `try/finally`-with-restore pattern translated to `Effect.ensuring` + `Effect.either`/`Effect.ignore`. Error branching now matches typed tags (`ConfigUpdateError` vs `CommandExecutionError`) rather than parsing exception messages.
- `workbench-cycler`: commit `c13cfbf` — handlers converted; `presets.ts` retains raw `vscode.commands.executeCommand` for the 12 workbench commands not yet declared as `externalCommands` (separate scope), bridged via `Effect.promise(() => applyPreset(name))`.

Every extension's `.oxlintrc.json` gained an allowlist for `_tag` and `_op` discriminators so Effect's tagged-class pattern doesn't trip `no-underscore-dangle`. This is now a standard pattern for any project using `effect`'s tagged unions.

**Test surface additions**

- `vscode-mock.ts` gains `workspace.updateWorkspaceFolders` and `window.showOpenDialog` plus `__state.{getUpdateFolderCalls,setNextUpdateFoldersResult,getOpenDialogCalls,setNextOpenDialogResult}` for behavioral assertions.
- New tests: `workspace.updateFolders` (success + rejected splice), `window.showOpenDialog` (selection + dismissal), `fs.realpath` (resolves real symlink in `os.tmpdir()`, broken symlink → `FileNotFoundError`, non-file scheme → `UnsupportedSchemeError`, non-existent path → `FileNotFoundError`).
- New error-path tests for `defineCommand` (handler failure → `CommandExecutionError`), `executeExternalCommand` (rejection → `CommandExecutionError`), `executeCommandRaw` (rejection → `CommandExecutionError`), `defineConfig.update` (write rejection → `ConfigUpdateError`), `defineState.set` (memento rejection → `StateUpdateError`), `clipboard.readText` (IPC failure → `ClipboardError`), `workspace.openTextDocument` (provider rejection → `DocumentOpenError`).

### Open

_(none — all open follow-ups have been addressed.)_
