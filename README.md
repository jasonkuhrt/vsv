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

Distributed via `bun link` — not published to npm. From this repo:

```bash
bun link                         # register @jasonkuhrt/vsv globally
```

In a consumer extension repo:

```bash
bun link @jasonkuhrt/vsv         # create the link
bun add effect                   # required — bun link does not install transitive deps
bun add -d tsx                   # required for the generated extension loader bootstrap
```

`bun link` only installs the linked package itself, not transitive dependencies. `effect` is needed at runtime for `Schema`; `tsx` is required at runtime by the generated `bootstrap.{cjs,mjs}` VSCode loader file.

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
