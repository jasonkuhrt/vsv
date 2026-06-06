// The prebuilt builtins manifest — VS Code's core `when` vocabulary, assembled
// into a single typed `defineManifest` so consumers can `When(builtinsManifest)`
// against the full core context-key + command catalog with zero hand-maintained
// name lists.
//
// `defineManifest`'s `<const M>` preserves the spread literal tuples, so the
// `When` builder recovers each key's name + value-domain Schema directly from
// these arrays — `eq('editorLangId', 'typescript')` autocompletes the known
// members while still accepting an unmodeled language, and `is('inputFocs')` is
// a compile error.

import { defineManifest } from '#lib/manifest/define'
import { coreCommands } from './commands.ts'
import { coreContextKeys } from './context-keys.ts'

/**
 * The vsv builtins manifest: every VS Code **core** context key (as
 * `externalContextKeys`) and command id (as `externalCommands`), value-typed.
 *
 * Use it as the manifest argument to `When(...)` to author `when` clauses over
 * core context keys, or merge its decl arrays into an extension's own manifest
 * alongside that extension's owned commands/context keys.
 *
 * @example
 * ```ts
 * import { When } from '@jasonkuhrt/vsv/when'
 * import { builtinsManifest } from '@jasonkuhrt/vsv/builtins'
 *
 * const $ = When(builtinsManifest)
 * const ast = $.and(
 *   $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor'),
 *   $.not($.is('inputFocus')),
 * )
 * ```
 */
export const builtinsManifest = defineManifest({
  name: 'vscode-builtins',
  publisher: 'vscode',
  displayName: 'VS Code Core Builtins',
  description: 'Prebuilt catalog of VS Code core context keys and commands.',
  externalContextKeys: [...coreContextKeys],
  externalCommands: [...coreCommands],
})

export { coreCommands } from './commands.ts'
export {
  booleanContextKeys,
  closedStringContextKeys,
  coreContextKeys,
  numericContextKeys,
  openEnumContextKeys,
  openStringContextKeys,
  plainStringContextKeys,
} from './context-keys.ts'
