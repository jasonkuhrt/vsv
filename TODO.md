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
