# vsv

**The VSCode SDK Microsoft never shipped.**

`@jasonkuhrt/vsv` (pronounced "VS Void") is the SDK that should have come with VSCode — a complete, declarative, typed surface for everything you could want to know or do with the editor. Extensions written against vsv operate at a distinctly higher level than raw `vscode.*` API code: they declare intent, and vsv handles the mechanical work of registering, typing, validating, and wiring the result.

## The vision

VSCode's extension API is a sprawling, untyped, imperative surface. Every consumer eventually rebuilds the same boilerplate: command id strings drift out of sync with handlers, `package.json` contributions duplicate runtime code, foreign command invocations pass `unknown` through `executeCommand`, settings are read with `vscode.workspace.getConfiguration(...).get<T>(key)` and the `T` is a lie nobody verifies.

vsv collapses all of that into one principle: **everything you could want to know or do with VSCode should be describable declaratively, in one place, type-checked end to end.**

Concretely, this means:

- **The manifest is the single source of truth.** `vsv.manifest.ts` declares every command, context key, configuration entry, persistent state slot, and event the extension contributes to or consumes from VSCode. From that one file, vsv generates `package.json` contributions, TypeScript registry types, the runtime bootstrap, and (eventually) typed wrappers for every imperative VSCode API the extension touches.
- **Imperative is a code smell.** If you find yourself writing `vscode.commands.executeCommand('someBuiltin', ...)`, that's a vsv gap. The cure is a declarative entry — an `ExternalCommandDecl` that types the call, an Effect-returning event subscription that's lifecycle-managed, an editor accessor that returns a typed Effect, or another runtime primitive. Extensions should reach for `vscode.*` only for value types and enums vsv hasn't yet wrapped.
- **Extensions are forcing functions.** Every consumer extension is a probe into vsv's coverage. When an extension needs something vsv doesn't have, the right move is to add it to vsv — not to reach past. Each gap that surfaces from real code becomes a permanent improvement in vsv's surface.

The endpoint is an SDK where you can author a non-trivial extension without ever importing from `'vscode'` directly. Every runtime operation vsv exposes is Effect-first; every consumer edge case that still needs raw VS Code should become new vsv surface.

## Principles

1. **Declarative over imperative.** Anything that can be expressed as a typed declaration in the manifest belongs in the manifest. Anything that cannot, but should be statically describable (events, accessors, lifecycles), gets a typed runtime primitive.
2. **One source of truth.** The manifest. `package.json`, registry types, and runtime bootstrap are _outputs_ — never edited by hand.
3. **Type safety end to end.** A command id typoed in `executeCommand` is a compile error. A setting whose value type drifts from its schema is a compile error. A persistent state slot whose scope mismatches the manifest is a compile error.
4. **No re-implementation, only re-shaping.** vsv is a surface over `vscode.*`, not a runtime replacement. Bugs and quirks are documented and routed; behavior is not duplicated.
5. **Forcing-function development.** New surface area is admitted when an extension needs it. Theoretical completeness is not a goal; consumer-driven completeness is.

## What it provides

- **Typed manifest DSL** via Effect Schema tagged classes — `CommandDecl`, `ExternalCommandDecl`, `ContextKeyDecl`, `ConfigDecl`, `StateDecl`, `Manifest`. Each field carries inline JSDoc; the manifest is itself documentation.
- **Codegen** from `vsv.manifest.ts` → TypeScript registries (`CommandRegistry`, `ExternalCommandRegistry`, `ContextKeyRegistry`, `ConfigRegistry`, `StateRegistry`) + `package.json` contributions sync.
- **Typed Effect runtime wrappers** over the `vscode` API — `defineCommand`, `executeCommand`, `defineContextKey`, `defineConfig`, `defineState`, `defineEvent`, `quickPick`, `disposables`, and editor/workspace/window helpers. Each is indexed by the corresponding registry where applicable so id/key/value-type drift is caught at compile time.
- **`bun:test`-native test utilities** with a hand-rolled `vscode` mock that covers the API shapes real extensions actually use, and is observable + settable for assertions.
- **Custom oxlint rules** for VSCode-specific bugs that the language can't catch on its own.
- **Loader-hook bootstrap generator** so consumer `.ts` source runs live under VSCode's Node extension host without a build step on every save.
- **CLI:** `vsv dev`, `vsv test`, `vsv lint`, `vsv typecheck`, `vsv check`, `vsv discover`.

## What it does NOT provide (yet)

vsv's coverage of the VSCode API is consumer-driven. Surface area lands when an extension needs it. Currently absent (representative, not exhaustive):

- Filesystem primitives (`workspace.fs.{readDirectory, stat, readFile, writeFile}`)
- Editor accessors (`window.activeTextEditor`, tab groups, text document modeling)
- Workspace folder accessors and watchers
- Notification primitives (`showInformationMessage`, `showWarningMessage`, `showErrorMessage`, `showInputBox`, status bar)
- Clipboard
- URI construction helpers
- Workspace edit construction
- Foreign command typing through `executeCommand` (the `ExternalCommandRegistry` is currently doc-only — see [`DEVIATIONS.md`](./TODO.md) and consumer notes)

If your extension needs one of these, the right move is to file the gap and add it to vsv.

## Quick start

### Installing

Not published to npm. Consume from a local checkout via a **file path** install:

```bash
# One-time: the CLI still registers globally for ergonomic `vsv` invocation.
cd /path/to/vsv
bun link
```

In a consumer extension repo:

```bash
# Install vsv's source physically into node_modules (NOT a symlink).
bun add file:/absolute/path/to/vsv

# Also install the transitive deps vsv cannot bundle for you.
bun add effect                   # required — Schema is not re-exported
bun add -d tsx                   # required at runtime by the generated bootstrap
```

#### Why `bun add file:` — not `bun link`

VSCode's extension host only resolves `require('vscode')` for files physically inside the registered extension directory. A `bun link` symlink points `node_modules/@jasonkuhrt/vsv` at the real vsv checkout (outside the extension), so vsv's compiled runtime calls `require('vscode')` from a path the host refuses to map, and `createRuntime()` resolves against a broken `vscode` object.

`bun add file:` physically copies vsv into `node_modules/@jasonkuhrt/vsv/`, which lives inside the extension directory — the host maps it correctly and everything Just Works.

After vsv changes, re-sync in the consumer:

```bash
bun add file:/absolute/path/to/vsv --force
```

(Consider scripting this as `sync-vsv` in consumer `package.json`.)

### Imports

Top-level and subpath imports both work. Top-level is the convenience form:

```ts
import { CommandDecl, createRuntime, defineManifest, Manifest } from '@jasonkuhrt/vsv'
```

Subpaths scope by area:

```ts
import { defineManifest, CommandDecl } from '@jasonkuhrt/vsv/manifest'
import { createRuntime } from '@jasonkuhrt/vsv/runtime'
import { installVSCodeMock, createTestExtensionContext } from '@jasonkuhrt/vsv/runtime/test'
```

The `./runtime/test` subpath is **only** imported from tests — it wires up `bun:test`'s `mock.module('vscode', ...)` and is not meant for extension runtime code.

### Test setup (Bun preload)

Bun resolves static imports before any test-file top-level code runs, so the vscode mock must register via preload. Add to your consumer's `bunfig.toml`:

```toml
[test]
preload = ["@jasonkuhrt/vsv/runtime/test/preload"]
```

Then a test:

```ts
import { beforeEach, expect, test } from 'bun:test'
import { installVSCodeMock, createTestExtensionContext } from '@jasonkuhrt/vsv/runtime/test'
import { activate } from '../src/extension.ts'

const vscode = installVSCodeMock()
beforeEach(() => vscode.reset())

test('activate registers expected commands', async () => {
  const ctx = createTestExtensionContext()
  await activate(ctx)
  expect(vscode.state.getRegisteredCommands()).toContain('myext.ping')
})
```

### Scripts (recommended)

```jsonc
// consumer package.json
{
  "scripts": {
    "dev": "vsv dev",
    "test": "bun test",
    "lint": "oxlint --type-aware",
    "typecheck": "tsgo",
    "check": "vsv check",
  },
}
```

## Contributing through your extensions

If you're using vsv to author an extension and you find yourself reaching past it (importing `vscode` directly for something more than a value type or enum), that reach is a vsv gap. Two paths forward:

1. **Surface the gap.** Open an issue or note describing what your extension needed and how you ended up writing it raw. Concrete consumer cases drive the prioritization.
2. **Close the gap.** Add the missing primitive to vsv, with JSDoc that explains its place in the surface, tests against the vscode mock, and (if applicable) a manifest decl so the typed registries pick it up.

Either way, your extension becomes the forcing function that pushes vsv closer to its perfectest form.

See [`COLDSTART.md`](./COLDSTART.md) for the full specification and [`TODO.md`](./TODO.md) for deferred work.

## Related projects

- **`@jasonkuhrt/key-binder`** — cross-editor keybinding source of truth. Emits `keybindings.json` (VS Code, per-binding ownership) and `keymaps.lua` (Neovim, whole-file ownership). No dep on vsv; shares design conventions (`_tag` discriminator, Effect Schema, branded primitives, "zero `string` types in public API").
- **`key-binder-glimpse`** — a VS Code extension authored on vsv. Its `vsv.manifest.ts` is the single source of truth for the extension's commands, context keys, and config; vsv generates the `package.json` contributions and TS registries from it.
