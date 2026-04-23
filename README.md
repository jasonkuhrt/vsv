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

See [`COLDSTART.md`](./COLDSTART.md) for the full specification.
