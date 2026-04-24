# vsv

`@jasonkuhrt/vsv` (CLI alias: `vsv`, pronounced "VS Void") is a personal dev-time SDK for authoring VSCode extensions on top of Bun and Effect.

It provides:

- A typed manifest DSL via Effect Schema tagged classes
- Codegen from `vsv.manifest.ts` to TypeScript registries and `package.json` sync
- Typed runtime wrappers over the `vscode` API
- `bun:test`-native test utilities with a hand-rolled vscode mock
- Custom oxlint rules for VSCode-specific bugs
- A loader-hook bootstrap generator so consumer `.ts` source runs live under VSCode's Node extension host
- CLI: `vsv dev`, `vsv test`, `vsv lint`, `vsv typecheck`, `vsv check`, `vsv discover`

## Installing

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

### Why `bun add file:` — not `bun link`

VSCode's extension host only resolves `require('vscode')` for files physically inside the registered extension directory. A `bun link` symlink points `node_modules/@jasonkuhrt/vsv` at the real vsv checkout (outside the extension), so vsv's compiled runtime calls `require('vscode')` from a path the host refuses to map, and `createRuntime()` resolves against a broken `vscode` object.

`bun add file:` physically copies vsv into `node_modules/@jasonkuhrt/vsv/`, which lives inside the extension directory — the host maps it correctly and everything Just Works.

After vsv changes, re-sync in the consumer:

```bash
bun add file:/absolute/path/to/vsv --force
```

(Consider scripting this as `sync-vsv` in consumer `package.json`.)

## Imports

Top-level and subpath imports both work. Top-level is the convenience form:

```ts
// Manifest + runtime (convenience)
import { CommandDecl, createRuntime, defineManifest, Manifest } from '@jasonkuhrt/vsv'
```

Subpaths are useful when you want to scope by area:

```ts
import { defineManifest, CommandDecl } from '@jasonkuhrt/vsv/manifest'
import { createRuntime } from '@jasonkuhrt/vsv/runtime'
import { installVSCodeMock, createTestExtensionContext } from '@jasonkuhrt/vsv/runtime/test'
```

The `./runtime/test` subpath is **only** imported from tests — it wires up `bun:test`'s `mock.module('vscode', ...)` and is not meant for extension runtime code.

## Test setup (Bun preload)

Because Bun resolves static imports before any test-file top-level code runs, the vscode mock must be registered via preload so `import * as vscode from 'vscode'` inside your extension source resolves to the mock. Add to your consumer's `bunfig.toml`:

```toml
[test]
preload = ["./node_modules/@jasonkuhrt/vsv/src/lib/runtime-test/preload.ts"]
```

Then a test looks like:

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

## Scripts (recommended)

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

See [`COLDSTART.md`](./COLDSTART.md) for the full specification and [`TODO.md`](./TODO.md) for deferred work.
