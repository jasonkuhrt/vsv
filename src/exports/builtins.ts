// Public entry point for vsv's prebuilt catalog of VS Code core `when`
// vocabulary. Pure (effect-only transitive dep) — inherits the Phase-A
// packaging + purity guarantees, since `src/lib/builtins/**` imports only
// `effect`, `#lib/manifest`, and the inlined `#lib/schema/open-enum`.

export { builtinsManifest } from '#lib/builtins/manifest';
export { coreCommands } from '#lib/builtins/commands';
export {
  booleanContextKeys,
  closedStringContextKeys,
  coreContextKeys,
  numericContextKeys,
  openEnumContextKeys,
  openStringContextKeys,
  plainStringContextKeys,
} from '#lib/builtins/context-keys';
