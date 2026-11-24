# vsv — Coldstart Spec (Derisked)

This document records the original scaffolding plan. The [README](./README.md) describes the current Effect 4 runtime, test layer, and compiler.

You are a coldstart agent. Your task is to scaffold and implement the initial version of **`@jasonkuhrt/vsv`**, a personal SDK for VSCode extension authoring on Jason Kuhrt's machine. Read this entire spec, especially §0, before doing anything.

---

## 0. Non-negotiables (read first)

### 0.1 Banned dependencies — do NOT introduce any of these

| Banned                                                 | Why                                       | Use instead                                          |
| ------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------- |
| `jest`, `jest-*`, anything with `jest` in the name     | User rejected Jest explicitly             | Bun's `bun:test` native runner                       |
| `jest-mock-vscode`                                     | Jest lineage + not needed                 | Hand-rolled vscode mock + Bun's `mock.module()`      |
| `vitest`, `@vitest/*`                                  | User's template uses `bun test`           | Bun's `bun:test` native runner                       |
| `mocha`, `chai`, `sinon`                               | Legacy JS testing stack                   | `bun:test`, native matchers, native spies            |
| `webpack`, `ts-loader`, `babel-loader`                 | Legacy bundler stack                      | N/A — no bundling in this project                    |
| `rollup`, `rolldown`, `vite`, `esbuild` as direct deps | Out of v1 scope (no bundling)             | N/A — ship source only, loader hook at consume time  |
| `@vscode/vsce`, `vsce`                                 | Out of v1 scope (no packaging)            | N/A                                                  |
| `eslint`, `@typescript-eslint/*`, `prettier`           | Template uses oxlint/oxfmt                | `oxlint --type-aware`, `oxfmt` (already in template) |
| `tsc` (in scripts)                                     | Template uses `tsgo` (native-preview)     | `tsgo`                                               |
| `ts-node`, `ts-node-dev`, `nodemon`                    | Bun/tsgo cover these                      | Bun native + `tsgo --watch`                          |
| `commander`, `yargs`, `cac`, `clipanion` for CLI       | Template already pulls `@effect/platform` | Use `@effect/platform`'s `Command` / `CliApp`        |
| Any `*-config-*` preset package for tsconfig/oxlint    | Template inlines these                    | Use template's config as-is                          |

If you find yourself about to `bun add` something not in the explicit dependency list (§2), STOP and ask.

### 0.2 Banned scope expansions — do NOT implement

- Bundling the extension (no Rolldown, no esbuild, no "optional build mode")
- Packaging as `.vsix`
- Publishing to the VSCode marketplace
- GitHub remote configuration, `gh` CLI usage, PR workflows
- Marketplace/telemetry/analytics integration
- Web worker extension host support (only Node extension host)
- Scaffold CLI (`vsv init` or similar) — consumer creates `vsv.manifest.ts` by hand
- README polish beyond a minimal "what is vsv" paragraph
- CHANGELOG maintenance
- CI/CD configuration beyond what the template ships

### 0.3 If blocked, stop — do not improvise

If a phase cannot be completed as specified:

1. Mark the current state clearly (what was done, what failed, where)
2. STOP — do not hack around the blocker, do not add speculative fallback logic
3. Surface the failure to the user with specific file:line references and the exact error message

Acceptable reasons to stop: a banned dependency seems necessary, a verification fails, an assumption contradicted by reality, unclear decision among alternatives the spec doesn't resolve.

Unacceptable: fabricating behavior to work around a failure, adding a dependency not in §2, skipping a verification step because it "should work."

### 0.4 Commit discipline

After each phase completes and verifications pass, make a single commit with the message:

```
phase <N>: <short description>
```

Example: `phase 3: manifest DSL with Effect Schema tagged classes`.

If a phase fails partway, do NOT commit partial work — revert and surface per §0.3.

---

## 1. What `vsv` is

`@jasonkuhrt/vsv` (CLI alias: `vsv`, pronounced "VS Void") is a dev-time SDK for authoring VSCode extensions. Runtime stack is **Bun all in**: vsv itself and every consumer extension use `bun install`, `bun test`, and `bun` as script runner. vsv's test utilities directly target `bun:test`'s `mock.module` API — there is no framework-agnostic abstraction layer. Consumers who prefer Vitest/Jest are out of scope for v1.

vsv provides:

1. A typed manifest DSL via Effect Schema tagged classes
2. Codegen from `vsv.manifest.ts` → TypeScript registries + `package.json` sync
3. Typed runtime wrappers over the `vscode` API
4. `bun:test`-native test utilities with hand-rolled vscode mock
5. Custom oxlint rules for VSCode-extension-specific bugs
6. Loader-hook bootstrap generation (`tsx`) so consumer source `.ts` runs live under VSCode's Node extension host
7. CLI: `vsv dev`, `vsv test`, `vsv lint`, `vsv typecheck`, `vsv check`, `vsv discover`

Consumer extensions use `bun link @jasonkuhrt/vsv` and import from `@jasonkuhrt/vsv/manifest`, `@jasonkuhrt/vsv/runtime`, etc.

### 1.1 Two runtime contexts in a consumer project

Consumer extension projects span two runtimes. Do not conflate them:

| Context                                                   | Runtime                        | TypeScript handling                                             | vscode module                                                          |
| --------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Consumer's **tests** (running under `bun test`)           | Bun                            | Native — Bun strips types                                       | Replaced via `bun:test`'s `mock.module` by vsv's `installVSCodeMock()` |
| Consumer's **extension at runtime** (activated by VSCode) | Node (VSCode's extension host) | `tsx` loader hook via generated `bootstrap.cjs`/`bootstrap.mjs` | Provided by the extension host itself                                  |

The loader hook is NOT used at test time and must NOT be loaded by test runs. The bootstrap generator only affects the consumer's `package.json.main` for VSCode's load path, not their test files.

## 2. Exact dependency list

These are the ONLY packages to add beyond what the template already includes.

### Production dependencies

```
effect                   (runtime — manifest schema, CLI)
@effect/platform         (CLI command framework)
@effect/platform-node    (node runner)
```

(These are in the template's `devDependencies`; move them to `dependencies` since vsv's runtime code uses them.)

### Dev dependencies (new)

```
@types/vscode            (type-only import for wrappers)
tsx                      (peer-required by loader hook — but see note below)
```

### Dev dependencies (already in template — retain)

```
@arethetypeswrong/cli
@tsconfig/node24
@tsconfig/strictest
@types/bun
@types/node
@typescript/native-preview
lint-staged
oxfmt
oxlint
oxlint-tsgolint
publint
typescript
```

### Dependencies to REMOVE from template

```
dripip          (versioning tool — not needed for local-only bun link)
floggy          (unclear value; if template scripts use it, keep; otherwise remove)
fast-glob       (unclear usage; check if template scripts reference it; remove if unused)
inquirer        (likely for template's bootstrap script; check and remove if unused)
markdown-toc    (README TOC generation — keep only if README is substantial; v1 skip)
```

After deletion, verify `bun install` completes clean.

### NOT to add

- `vscode` — not an npm package (deprecated in favor of `@types/vscode` + host-provided runtime)
- Any Jest-lineage mock library
- Any bundler

### Note on `tsx`

`tsx` is the loader used by the generated bootstrap file in consumers, NOT by vsv itself at runtime. vsv's `bootstrap-generator.ts` should emit a bootstrap file that `require`s `tsx/cjs` or registers `tsx/esm`. The consumer must have `tsx` installed. vsv documents this as a peer-required install, not an auto-installed dep.

Verify `tsx` actually supports runtime type-stripping for VSCode's extension host empirically during Phase 9. If it doesn't, STOP per §0.3.

---

## 3. Technical foundation

| Concern                 | Tool                                                            |
| ----------------------- | --------------------------------------------------------------- |
| Runtime                 | Bun (latest stable)                                             |
| Language                | TypeScript, ESM only (`"type": "module"`)                       |
| Type checker            | `tsgo` via `@typescript/native-preview`                         |
| Test runner             | `bun test` — import from `"bun:test"`                           |
| Module mocking in tests | Bun's `mock.module()` — nothing else                            |
| Linter                  | `oxlint --type-aware` with `oxlint-tsgolint`                    |
| Formatter               | `oxfmt`                                                         |
| Schema / types          | `effect`, specifically `Schema.TaggedClass` patterns            |
| CLI framework           | `@effect/platform` `Command` / `CliApp`                         |
| Template base           | `/Users/jasonkuhrt/projects/jasonkuhrt/template-typescript-lib` |

## 4. Target location

Create the project at:

```
/Users/jasonkuhrt/projects/jasonkuhrt/vsv/
```

Single-package repo (no monorepo). Consumer extensions live in sibling directories and link via `bun link @jasonkuhrt/vsv`.

## 5. Effect Schema conventions (MANDATORY)

### 5.1 Use `Schema.TaggedClass` for named models

```typescript
import { Schema } from 'effect';

export class CommandDecl extends Schema.TaggedClass<CommandDecl>()(
  'CommandDecl',
  {
    id: Schema.NonEmptyTrimmedString,
    args: Schema.Unknown,
    result: Schema.Unknown,
  },
) {}
```

### 5.2 Construct via `.make`, never via plain object literals

```typescript
// GOOD
const decl = CommandDecl.make({ id: 'foo', args: ..., result: ... })

// BANNED
const decl = { _tag: 'CommandDecl', id: 'foo', ... }
```

### 5.3 Derive types from schema, don't parallel-declare

```typescript
// GOOD — one source of truth
const decl = CommandDecl.make({ ... })
type Decl = Schema.Schema.Type<typeof CommandDecl>

// BANNED — parallel declaration
type Decl = { id: string; args: unknown; result: unknown }
```

### 5.4 Encode/decode at boundaries

Reading untyped input (e.g., parsed JSON from `package.json`): `Schema.decodeUnknownSync(Manifest)(raw)`. Writing typed data back out: `Schema.encodeSync(Manifest)(instance)`. Never hand-serialize or hand-parse.

---

## 6. Package structure

```
vsv/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── bunfig.toml
├── .oxlintrc.json
├── LICENSE                (MIT, same as template)
├── README.md              (minimal: "vsv is ..." + link to this spec)
├── COLDSTART.md           (copy of this file — see Phase 10)
├── src/
│   ├── exports/
│   │   ├── index.ts
│   │   ├── manifest.ts
│   │   ├── runtime.ts
│   │   ├── runtime-test.ts
│   │   └── cli.ts
│   └── lib/
│       ├── manifest/
│       │   ├── schema.ts
│       │   ├── define.ts
│       │   └── tests/
│       ├── runtime/
│       │   ├── create.ts         (createRuntime)
│       │   ├── command.ts
│       │   ├── context-key.ts
│       │   ├── config.ts
│       │   ├── event.ts
│       │   ├── state.ts
│       │   ├── quick-pick.ts
│       │   ├── disposables.ts
│       │   └── tests/
│       ├── runtime-test/
│       │   ├── vscode-mock.ts    (hand-rolled vscode module mock)
│       │   ├── install-mock.ts   (installVSCodeMock via mock.module)
│       │   ├── create-context.ts (createTestExtensionContext)
│       │   ├── matchers.ts
│       │   ├── spies.ts
│       │   └── tests/
│       ├── codegen/
│       │   ├── engine.ts
│       │   ├── emit-registries.ts
│       │   ├── sync-package-json.ts
│       │   ├── schema-to-ts.ts   (Effect Schema → TS type source string)
│       │   └── tests/
│       ├── oxlint-plugin/
│       │   ├── index.ts
│       │   ├── rules/
│       │   │   ├── no-unregistered-command.ts
│       │   │   └── no-unregistered-context-key.ts
│       │   └── tests/
│       ├── loader-hook/
│       │   ├── bootstrap-generator.ts
│       │   └── tests/
│       ├── cli/
│       │   ├── main.ts
│       │   ├── commands/
│       │   │   ├── dev.ts
│       │   │   ├── test.ts
│       │   │   ├── lint.ts
│       │   │   ├── typecheck.ts
│       │   │   ├── check.ts
│       │   │   └── discover.ts
│       │   └── tests/
│       └── builtin-catalog/
│           ├── commands.ts       (stub — empty export for v1)
│           └── context-keys.ts   (stub — empty export for v1)
├── tests/                        (integration tests)
└── build/                        (tsgo output — gitignored)
```

## 7. `package.json` (exact target shape)

```jsonc
{
  "name": "@jasonkuhrt/vsv",
  "version": "0.0.0",
  "type": "module",
  "sideEffects": false,
  "license": "MIT",
  "author": {
    "name": "Jason Kuhrt",
    "url": "https://kuhrt.me",
  },
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/jasonkuhrt/vsv.git",
  },
  "keywords": ["vscode", "extension", "sdk", "effect", "voidzero", "bun"],
  "bin": {
    "vsv": "./build/exports/cli.js",
  },
  "imports": {
    "#lib/*": "./src/lib/*.ts",
  },
  "exports": {
    ".": "./build/exports/index.js",
    "./manifest": "./build/exports/manifest.js",
    "./runtime": "./build/exports/runtime.js",
    "./runtime/test": "./build/exports/runtime-test.js",
    "./cli": "./build/exports/cli.js",
  },
  "files": ["build", "src", "README.md", "COLDSTART.md"],
  "dependencies": {
    "effect": "^3.19.19",
    "@effect/platform": "^0.94.5",
    "@effect/platform-node": "^0.104.1",
  },
  "devDependencies": {
    "@arethetypeswrong/cli": "^0.18.2",
    "@tsconfig/node24": "^24.0.4",
    "@tsconfig/strictest": "2.0.8",
    "@types/bun": "^1.3.10",
    "@types/node": "^25.3.5",
    "@types/vscode": "^1.100.0",
    "@typescript/native-preview": "7.0.0-dev.20260306.1",
    "lint-staged": "^16.4.0",
    "oxfmt": "^0.36.0",
    "oxlint": "^1.51.0",
    "oxlint-tsgolint": "^0.16.0",
    "publint": "^0.3.18",
    "typescript": "5.9.3",
  },
  "scripts": {
    "build": "tsgo --build tsconfig.build.json",
    "build:clean": "tsgo --build --clean && rm -rf build",
    "prebuild": "bun run build:clean",
    "build:watch": "bun run build --watch",
    "test": "bun test src tests",
    "test:coverage": "bun test --coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage src tests",
    "fix": "bun run fix:format && bun run fix:lint",
    "fix:format": "oxfmt --write",
    "fix:lint": "oxlint --type-aware --fix-dangerously --deny-warnings",
    "check": "bun run check:format && bun run check:lint && bun run check:types && bun run test && bun run check:package && bun run check:exports",
    "check:format": "oxfmt --check",
    "check:lint": "oxlint --type-aware --deny-warnings",
    "check:types": "tsgo",
    "check:package": "publint run --strict",
    "check:exports": "attw --pack . --profile esm-only",
  },
}
```

Note: NO `vscode` in `peerDependencies` (the `vscode` module is not on npm; host provides it at runtime).

---

## 8. Manifest DSL

See §5 for conventions. Full sketch of `src/lib/manifest/schema.ts`:

```typescript
import { Schema } from 'effect';

export class CommandDecl extends Schema.TaggedClass<CommandDecl>()(
  'CommandDecl',
  {
    id: Schema.NonEmptyTrimmedString,
    args: Schema.Unknown,
    result: Schema.Unknown,
    title: Schema.optional(Schema.String),
    category: Schema.optional(Schema.String),
  },
) {}

export class ExternalCommandDecl extends Schema.TaggedClass<ExternalCommandDecl>()(
  'ExternalCommandDecl',
  {
    id: Schema.NonEmptyTrimmedString,
    args: Schema.Unknown,
    result: Schema.Unknown,
    fromExtension: Schema.optional(Schema.String),
  },
) {}

export class ContextKeyDecl extends Schema.TaggedClass<ContextKeyDecl>()(
  'ContextKeyDecl',
  {
    name: Schema.NonEmptyTrimmedString,
    valueType: Schema.Unknown,
    defaultValue: Schema.optional(Schema.Unknown),
  },
) {}

export class ConfigDecl extends Schema.TaggedClass<ConfigDecl>()('ConfigDecl', {
  key: Schema.NonEmptyTrimmedString,
  valueSchema: Schema.Unknown,
  description: Schema.optional(Schema.String),
}) {}

export class StateDecl extends Schema.TaggedClass<StateDecl>()('StateDecl', {
  key: Schema.NonEmptyTrimmedString,
  scope: Schema.Literal('global', 'workspace'),
  valueSchema: Schema.Unknown,
}) {}

export class Manifest extends Schema.TaggedClass<Manifest>()('Manifest', {
  name: Schema.NonEmptyTrimmedString,
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  publisher: Schema.optional(Schema.String),
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
```

`src/lib/manifest/define.ts`:

```typescript
import { Manifest } from './schema.ts';
export const defineManifest = Manifest.make;
```

## 9. Runtime wrappers

Primary API: `createRuntime<CommandRegistry, ContextKeyRegistry, ...>()`. Individual wrappers compose under this.

```typescript
// src/lib/runtime/create.ts
import * as vscode from 'vscode';

export type CommandRegistryShape = Record<
  string,
  { args: unknown; result: unknown }
>;
export type ContextKeyRegistryShape = Record<string, unknown>;
// ... one per registry type

export const createRuntime = <
  CR extends CommandRegistryShape = CommandRegistryShape,
  CKR extends ContextKeyRegistryShape = ContextKeyRegistryShape,
  // ... others
>() => ({
  defineCommand: <Id extends keyof CR & string>(
    id: Id,
    handler: (args: CR[Id]['args']) => Promise<CR[Id]['result']>,
  ): vscode.Disposable => vscode.commands.registerCommand(id, handler),

  executeCommand: <Id extends keyof CR & string>(
    id: Id,
    args: CR[Id]['args'],
  ): Promise<CR[Id]['result']> =>
    Promise.resolve(vscode.commands.executeCommand(id, args)),

  executeCommandRaw: (id: string, ...args: unknown[]): Promise<unknown> =>
    Promise.resolve(vscode.commands.executeCommand(id, ...args)),

  defineContextKey: <K extends keyof CKR & string>(
    key: K,
    initialValue: CKR[K],
  ) => {
    let current = initialValue;
    const listeners = new Set<(v: CKR[K]) => void>();
    vscode.commands.executeCommand('setContext', key, current);
    return {
      set: async (value: CKR[K]) => {
        current = value;
        await vscode.commands.executeCommand('setContext', key, value);
        listeners.forEach((l) => l(value));
      },
      get: () => current,
      onChange: (cb: (v: CKR[K]) => void): vscode.Disposable => {
        listeners.add(cb);
        return { dispose: () => listeners.delete(cb) };
      },
    };
  },

  // defineConfig, defineEvent, defineState, quickPick, disposables — implement per §9 conventions below
});
```

Implement full set: `defineCommand`, `executeCommand`, `executeCommandRaw`, `defineContextKey`, `defineConfig`, `defineEvent`, `defineState`, `quickPick`, `disposables`.

## 10. Codegen

### 10.1 Inputs

- Consumer's `vsv.manifest.ts` at `${consumerRoot}/vsv.manifest.ts` (default export is a `Manifest` instance)
- Consumer's `package.json` at `${consumerRoot}/package.json`

### 10.2 Outputs

- `${consumerRoot}/src/generated/registries.ts` — TypeScript registry types
- `${consumerRoot}/package.json` — merged with manifest-derived fields

### 10.3 Registry type emission approach

Effect Schema provides `JSONSchema.make(schema)` — use it to convert each declared `args`, `result`, `valueType`, `valueSchema` into JSON Schema.

For TS type emission, write a minimal converter in `src/lib/codegen/schema-to-ts.ts`:

- `Schema.String` → `string`
- `Schema.Number` → `number`
- `Schema.Boolean` → `boolean`
- `Schema.Void` / `Schema.Undefined` → `void` / `undefined`
- `Schema.Null` → `null`
- `Schema.Array(T)` → `Array<emit(T)>`
- `Schema.Struct({ k: T, ... })` → `{ k: emit(T); ... }`
- `Schema.Literal('x')` → `'x'`
- `Schema.Union(...)` → `emit(T1) | emit(T2) | ...`
- `Schema.Record({ key, value })` → `Record<emit(key), emit(value)>`
- `Schema.optional(T)` → `(emit(T) | undefined)` on property, plus `?:` on key if in struct

Walk via `schema.ast` (the AST property on every Schema). If an AST node isn't in the mapping above, emit `unknown` and log a warning. Do NOT attempt to handle every case — v1 supports the common ones.

### 10.4 package.json sync fields

Derive from manifest:

- `name` ← `manifest.name`
- `displayName` ← `manifest.displayName`
- `description` ← `manifest.description`
- `publisher` ← `manifest.publisher`
- `version` ← `manifest.version`
- `engines.vscode` ← `manifest.engineVscode`
- `activationEvents` ← `manifest.activationEvents`
- `extensionDependencies` ← `manifest.extensionDependencies`
- `contributes.commands` ← `manifest.commands.map(c => ({ command: c.id, title: c.title, category: c.category }))`
- `contributes.configuration` ← JSON Schema emitted from `manifest.config` entries

Leave ALL other package.json fields untouched (main, scripts, dependencies, devDependencies, bin, exports, etc.).

### 10.5 Write strategy

1. Read existing `package.json` via `Bun.file(path).json()`
2. Compute merged object (deep merge of manifest-derived fields over existing, but REPLACE the specific arrays/objects wholesale rather than array-concat)
3. Write atomically via `Bun.write(tempPath, serialized)` then rename (`node:fs/promises` `rename` — Bun doesn't have a dedicated rename yet)
4. Format with `oxfmt` after write

### 10.6 Bun-native API preference

Throughout vsv's internal code, prefer Bun globals over `node:*` equivalents when available:

| Task                | Use                                              | Not                            |
| ------------------- | ------------------------------------------------ | ------------------------------ |
| Read file           | `Bun.file(path).text()` / `.json()` / `.bytes()` | `node:fs/promises` `readFile`  |
| Write file          | `Bun.write(path, data)`                          | `node:fs/promises` `writeFile` |
| Spawn subprocess    | `Bun.spawn([cmd, ...args])`                      | `node:child_process` `spawn`   |
| Glob files          | `new Bun.Glob(pattern).scan(dir)`                | `fast-glob`, `globby`          |
| Watch files         | Bun's `fs.watch` (same API as Node but faster)   | `chokidar` (banned)            |
| Current working dir | `process.cwd()` (works in Bun)                   | —                              |
| Path manipulation   | `node:path` (no Bun equivalent)                  | —                              |

Fall back to `node:*` only when Bun has no equivalent. Do not add userland glob/watcher packages.

---

## 11. Custom oxlint rules (v1: ship 2, structure for more)

Implement ONLY these two rules for v1:

1. **`no-unregistered-command`** — Flag string literal passed to `registerCommand`, `executeCommand`, or their `createRuntime`-produced aliases if the literal is not present in `src/generated/registries.ts`'s `CommandRegistry` keys.

2. **`no-unregistered-context-key`** — Flag string literal passed to `setContext` or `defineContextKey` if the literal is not present in `ContextKeyRegistry` keys.

Both rules read the consumer's `src/generated/registries.ts` at lint time. If the file doesn't exist, rules emit a diagnostic "run `vsv dev` first" and return; they do not error.

Defer (do NOT implement in v1): `dispose-disposable`, `activation-events-cover-commands`, `config-key-matches-manifest`, `external-command-needs-dependency`. List them in a `TODO.md` file at repo root.

Plugin structure per Oxlint JS Plugin docs — use the ESLint v9+ compatible API.

---

## 12. Test utilities

### 12.1 Hand-rolled vscode mock

`src/lib/runtime-test/vscode-mock.ts` exports a module-shaped object matching the subset of the `vscode` API that vsv's runtime wrappers use:

```typescript
// Exports to include (minimum viable):
export const commands = {
  registerCommand: (id: string, handler: Function) => ({ dispose: () => {} }),
  executeCommand: async (id: string, ...args: unknown[]) => {
    /* ... */
  },
  getCommands: async (filterInternal?: boolean) => [] as string[],
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    /* WorkspaceConfiguration surface */
  }),
};

export const window = {
  showQuickPick: async (items: unknown, opts?: unknown) => undefined,
  // ... as needed
};

export class EventEmitter<T> {
  /* fire, event, dispose */
}
export class Disposable {
  constructor(public callOnDispose: () => void) {}
  dispose() {
    this.callOnDispose();
  }
  static from(...disposables: Disposable[]): Disposable {
    /* ... */
  }
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;
// ... other enums/classes as needed
```

The mock must be **stateful** internally — track registered commands, setContext calls, etc. — and expose inspection helpers:

```typescript
export const __state = {
  reset: () => { /* clear all state */ },
  getRegisteredCommands: () => string[],
  getExecutedCommands: () => Array<{ id: string; args: unknown[] }>,
  getContextKeys: () => Record<string, unknown>,
  // ...
}
```

### 12.2 Mock installation

`src/lib/runtime-test/install-mock.ts`:

```typescript
import { mock } from 'bun:test';
import * as vscodeMock from './vscode-mock.ts';

export const installVSCodeMock = () => {
  mock.module('vscode', () => vscodeMock);
  return {
    reset: () => vscodeMock.__state.reset(),
    state: vscodeMock.__state,
  };
};
```

### 12.3 ExtensionContext mock

`src/lib/runtime-test/create-context.ts`:

```typescript
export const createTestExtensionContext = () => ({
  subscriptions: [] as Array<{ dispose: () => void }>,
  globalState: createMockMemento(),
  workspaceState: createMockMemento(),
  extensionUri: { fsPath: '/test', toString: () => 'test:/' },
  // ... stub others as needed
});

const createMockMemento = () => {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (store.get(key) as T) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    keys: () => Array.from(store.keys()),
  };
};
```

### 12.4 Matchers

`src/lib/runtime-test/matchers.ts`:

```typescript
import { expect } from 'bun:test';

expect.extend({
  toHaveRegisteredCommand(
    received: ReturnType<typeof installVSCodeMock>,
    id: string,
  ) {
    const has = received.state.getRegisteredCommands().includes(id);
    return {
      pass: has,
      message: () =>
        has
          ? `Expected vscode mock not to have command ${id}`
          : `Expected vscode mock to have command ${id}, got [${received.state.getRegisteredCommands().join(', ')}]`,
    };
  },
  // toHaveExecutedCommand, toHaveContextKey, etc.
});
```

### 12.5 Spies

`src/lib/runtime-test/spies.ts`:

```typescript
export const spyOnCommands = () => {
  // Returns an object that records command executions made through the vscode mock
  // Backed by the mock's __state.getExecutedCommands()
};

export const withContextKeys = async (
  keys: Record<string, unknown>,
  fn: () => Promise<void>,
): Promise<void> => {
  // Set context keys, run fn, restore
};
```

---

## 13. Loader-hook bootstrap generator

`src/lib/loader-hook/bootstrap-generator.ts`:

Reads consumer's `package.json` to determine CJS vs ESM (by `"type": "module"` presence).

### CJS output

```javascript
// bootstrap.cjs — generated by vsv, do not edit
require('tsx/cjs');
module.exports = require('./src/extension.ts');
```

### ESM output

```javascript
// bootstrap.mjs — generated by vsv, do not edit
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('tsx/esm', pathToFileURL(import.meta.url));
const mod = await import('./src/extension.ts');
export const activate = mod.activate;
export const deactivate = mod.deactivate;
```

Generator:

1. Detects mode from `package.json`
2. Writes the appropriate bootstrap file at `${consumerRoot}/bootstrap.{cjs,mjs}`
3. If `package.json.main` is not pointing at the bootstrap, updates it (warn user first)
4. Emits a warning if `tsx` is not in consumer's `devDependencies`

Idempotent — re-running produces identical output if state is correct; otherwise updates.

---

## 14. CLI

`src/lib/cli/main.ts` uses `@effect/platform`'s `Command` / `CliApp`:

```typescript
#!/usr/bin/env bun
// Use @effect/platform's Command.make and CliApp.run.
// See https://effect.website/docs/platform/command-line-apps for reference.
```

Subcommands per §14 of the original spec. First line of the compiled output must be `#!/usr/bin/env bun` shebang — set via esbuild-like banner or post-processing step.

| Subcommand      | Behavior                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `vsv dev`       | Load manifest, run codegen, emit bootstrap, watch for changes. Ctrl+C to exit.                                                                  |
| `vsv test`      | `bun test src tests` in consumer's project                                                                                                      |
| `vsv lint`      | `oxlint --type-aware --deny-warnings` in consumer                                                                                               |
| `vsv typecheck` | `tsgo` in consumer                                                                                                                              |
| `vsv check`     | Sequence: lint → typecheck → test                                                                                                               |
| `vsv discover`  | Print instructions (v1 stub — just a markdown block explaining how to manually dump `vscode.commands.getCommands()` from an extension dev host) |

For `vsv dev`, the watch loop uses Bun's native `fs.watch` (same API as Node but faster). Do not add a dependency like `chokidar`. See §10.6 for the broader Bun-native API preference.

---

## 15. Built-in catalog stubs

`src/lib/builtin-catalog/commands.ts`:

```typescript
// TODO: populate from VSCode source at https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/actions/layoutActions.ts (and siblings)
// For v1, empty.
export const BuiltinCommands = {} as const;
export type BuiltinCommandRegistry = typeof BuiltinCommands;
```

`src/lib/builtin-catalog/context-keys.ts`:

```typescript
// TODO: populate from VSCode context key registrations.
// For v1, empty.
export const BuiltinContextKeys = {} as const;
export type BuiltinContextKeyRegistry = typeof BuiltinContextKeys;
```

Codegen merges these empty objects into the emitted registries. Once populated later, consumers automatically pick them up.

---

## 16. Implementation phases

Execute in order. Verify after each. Commit after each successful verification per §0.4.

### Phase 1: Scaffold from template

1. `cp -r /Users/jasonkuhrt/projects/jasonkuhrt/template-typescript-lib /Users/jasonkuhrt/projects/jasonkuhrt/vsv`
2. `cd /Users/jasonkuhrt/projects/jasonkuhrt/vsv`
3. Remove template artifacts: `rm -rf node_modules build coverage bun.lock .git` (template may not have `.git`; ignore if missing)
4. Update `package.json` to match §7 exactly
5. Delete template's `scripts/bootstrap.ts` and related scripts if they reference removed deps (`floggy`, `inquirer`, `markdown-toc`)
6. Delete template's existing `src/` contents (keep directory) — we'll create fresh
7. Ensure `.gitignore` includes `build/`, `node_modules/`, `coverage/`, `bun.lock` is tracked
8. `bun install` — must complete clean
9. Verify: no reference to template's original `src/` files remains

**Commit**: `phase 1: scaffold from template-typescript-lib`

### Phase 2: Baseline health check

1. Create a placeholder `src/exports/index.ts`: `export const VERSION = '0.0.0'`
2. `bun run build` — must succeed
3. `bun run check:types` — must be green
4. `bun run check:lint` — must be green (may need to create an `.oxlintrc.json` if template doesn't have one)
5. `bun test` — should pass (no tests yet, green is fine)

**Commit**: `phase 2: baseline build passes`

### Phase 3: Manifest DSL

1. Create `src/lib/manifest/schema.ts` per §8
2. Create `src/lib/manifest/define.ts`
3. Create `src/exports/manifest.ts` re-exporting all public manifest symbols
4. Add to `src/exports/index.ts` a re-export from `./manifest.ts`
5. Write tests in `src/lib/manifest/tests/schema.test.ts`:
   - Construct Manifest via `.make` — assert all fields accessible
   - Decode a plain object via `Schema.decodeUnknownSync(Manifest)(raw)`
   - Encode a Manifest back — assert round-trip
   - Reject invalid input (missing required fields)
6. Verify: `bun test src/lib/manifest` all green; `bun run check:types` green

**Commit**: `phase 3: manifest DSL with Effect Schema tagged classes`

### Phase 4: Test utilities (before runtime wrappers — needed for wrapper tests)

1. Create `src/lib/runtime-test/vscode-mock.ts` per §12.1
2. Create `src/lib/runtime-test/install-mock.ts` per §12.2
3. Create `src/lib/runtime-test/create-context.ts` per §12.3
4. Create `src/lib/runtime-test/matchers.ts` per §12.4
5. Create `src/lib/runtime-test/spies.ts` per §12.5
6. Create `src/exports/runtime-test.ts` re-exporting
7. Self-test: write `src/lib/runtime-test/tests/install-mock.test.ts` that installs the mock, calls a mock method, asserts state

**Commit**: `phase 4: test utilities with hand-rolled vscode mock`

### Phase 5: Runtime wrappers

1. Create `src/lib/runtime/create.ts` with full `createRuntime` per §9
2. Create individual files per part if splitting
3. Create `src/exports/runtime.ts` re-exporting
4. Write tests using the Phase 4 utilities
5. Verify tests cover: defineCommand registers, executeCommand invokes, defineContextKey sets/gets, onChange fires, defineConfig reads, defineState persists, etc.

**Commit**: `phase 5: runtime wrappers with typed registries`

### Phase 6: Codegen

1. Create `src/lib/codegen/schema-to-ts.ts` per §10.3
2. Create `src/lib/codegen/emit-registries.ts` per §10
3. Create `src/lib/codegen/sync-package-json.ts` per §10.4–10.5
4. Create `src/lib/codegen/engine.ts` tying them together
5. Tests: fixture `Manifest` instances → assert emitted TS output is valid TypeScript + matches snapshot; fixture package.json merges produce expected output

**Commit**: `phase 6: codegen emits registries and syncs package.json`

### Phase 7: Oxlint plugin (2 rules only)

1. `src/lib/oxlint-plugin/rules/no-unregistered-command.ts`
2. `src/lib/oxlint-plugin/rules/no-unregistered-context-key.ts`
3. `src/lib/oxlint-plugin/index.ts` exporting the plugin
4. Create `TODO.md` listing the deferred rules
5. Tests: fixtures triggering each rule

**Commit**: `phase 7: oxlint plugin with two VSCode-specific rules`

### Phase 8: Loader-hook generator

1. `src/lib/loader-hook/bootstrap-generator.ts` per §13
2. Tests: assert correct CJS and ESM bootstrap outputs given fixture package.json files

**Commit**: `phase 8: loader-hook bootstrap generator`

### Phase 9: CLI

1. `src/lib/cli/main.ts` using `@effect/platform`
2. `src/lib/cli/commands/*.ts` for each subcommand
3. `src/exports/cli.ts` — entry point with shebang
4. Build output verification:
   - `bun run build`
   - Check `build/exports/cli.js` exists and starts with `#!/usr/bin/env bun`
5. Smoke test:
   - `bun ./build/exports/cli.js --help` — must print usage
   - Create a scratch directory with a minimal `vsv.manifest.ts`, run `bun ./build/exports/cli.js dev --once` (add a one-shot mode for verification) — verify `src/generated/registries.ts` is emitted

If the smoke test fails, STOP per §0.3.

**Commit**: `phase 9: CLI entry with subcommands`

### Phase 10: Git and bun link

```bash
cd /Users/jasonkuhrt/projects/jasonkuhrt/vsv

# If not already a git repo:
git init

# Copy the spec into the repo
cp /Users/jasonkuhrt/projects/jasonkuhrt/vsv-coldstart.md ./COLDSTART.md

# Clean state
git add -A
git status  # verify

# Final commit
git commit -m "phase 10: add COLDSTART.md, initial release"

# Build once more for link
bun run build

# Register globally
bun link

# Verification:
which vsv || command -v vsv
# Expected: a path resolved via bun's global bin
vsv --help
# Expected: usage output
```

**Do not create a GitHub remote. Do not push.**

### Phase 11: Final verification gauntlet

Run in vsv repo:

```bash
bun run check
```

All of the following must be green:

- `check:format` (oxfmt)
- `check:lint` (oxlint --type-aware)
- `check:types` (tsgo)
- `test` (bun test)
- `check:package` (publint)
- `check:exports` (attw)

If any fails, STOP per §0.3.

---

## 17. Success criteria (final)

- [ ] `vsv` directory at `/Users/jasonkuhrt/projects/jasonkuhrt/vsv/`
- [ ] `package.json` matches §7 shape; name is `@jasonkuhrt/vsv`
- [ ] `bun install` clean
- [ ] `bun run check` all green
- [ ] `bun run build` produces `build/` with compiled JS
- [ ] `bun link` succeeds
- [ ] `vsv --help` runs from any directory
- [ ] Exports present: `@jasonkuhrt/vsv/manifest`, `@jasonkuhrt/vsv/runtime`, `@jasonkuhrt/vsv/runtime/test`, `@jasonkuhrt/vsv/cli`
- [ ] Only 2 oxlint rules implemented; deferred rules listed in `TODO.md`
- [ ] `COLDSTART.md` copied into repo
- [ ] Git history: one commit per phase (11 total)
- [ ] No GitHub remote configured
- [ ] Zero Jest-lineage dependencies in `package.json`
- [ ] Every named model uses `Schema.TaggedClass`; no parallel plain-type declarations

## 18. Handoff output

Print at completion:

```
vsv scaffolded at /Users/jasonkuhrt/projects/jasonkuhrt/vsv
CLI linked globally (@jasonkuhrt/vsv → vsv)

To consume from an extension repo (Bun all in):

  cd /path/to/your-extension
  bun link @jasonkuhrt/vsv

  # Source code imports:
  #   import { defineManifest, CommandDecl } from '@jasonkuhrt/vsv/manifest'
  #   import { createRuntime } from '@jasonkuhrt/vsv/runtime'

  # Test code (tests run under `bun test`):
  #   import { test, expect, beforeEach } from 'bun:test'
  #   import {
  #     installVSCodeMock,
  #     createTestExtensionContext,
  #   } from '@jasonkuhrt/vsv/runtime/test'
  #
  #   const vscode = installVSCodeMock()
  #
  #   beforeEach(() => vscode.reset())
  #
  #   test('activate registers the preset command', async () => {
  #     const ctx = createTestExtensionContext()
  #     await activate(ctx)
  #     expect(vscode.state.getRegisteredCommands())
  #       .toContain('workbenchCycler.applyPreset')
  #   })

  # Scripts in consumer's package.json:
  #   "scripts": {
  #     "dev":       "vsv dev",
  #     "test":      "bun test",
  #     "lint":      "oxlint --type-aware",
  #     "typecheck": "tsgo",
  #     "check":     "vsv check"
  #   }

Outstanding TODOs (see TODO.md in repo):
  - Additional oxlint rules (4 deferred)
  - Built-in VSCode command catalog
  - Built-in VSCode context key catalog
  - Empirical verification of tsx loader hook in extension host

No GitHub remote configured. To publish later: add remote + bun publish.
```

---

End of spec. Begin Phase 1.
