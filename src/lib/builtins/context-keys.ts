// Prebuilt catalog of VS Code **core** context keys, value-typed.
//
// Every entry is an `ExternalContextKeyDecl` (owned by VS Code core, not by a
// consuming extension), so referencing one in a `when` clause types the key +
// its value domain without claiming `package.json#contributes` ownership.
//
// Value-domain model (Phase B decision — FULL catalog, ALL known domains):
//   - boolean keys        → `Schema.Boolean`
//   - numeric keys        → `Schema.Number`
//   - closed string keys  → `Schema.Literal(...)` (genuinely fixed small set)
//   - open string keys    → `OpenEnum(name, members)` — known core members
//     autocomplete while remaining open to runtime-registered values
//     (languages, schemes, view/panel/editor ids, …).
//
// Source of truth for the key set + value domains: `~/repo-references/vscode/`
// (see memory `reference_vscode_context_keys`). Imports only `effect` +
// `#lib/manifest` + the inlined `#lib/schema/open-enum`, so this module stays
// inside vsv's pure library subset and passes the Phase-A purity guard.

import { Schema } from 'effect'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { OpenEnum } from '#lib/schema/open-enum'

const ownedBy = 'vscode core'

const boolKey = <const N extends string>(name: N) =>
  ExternalContextKeyDecl({ name, valueType: Schema.Boolean, ownedBy })

const numberKey = <const N extends string>(name: N) =>
  ExternalContextKeyDecl({ name, valueType: Schema.Number, ownedBy })

// ─── Boolean context keys ─────────────────────────────────────────────────

/** VS Code core context keys whose value domain is a plain boolean. */
export const booleanContextKeys = [
  // Editor focus / input
  boolKey('inputFocus'),
  boolKey('editorTextFocus'),
  boolKey('editorFocus'),
  boolKey('textInputFocus'),
  boolKey('editorReadonly'),
  boolKey('editorColumnSelection'),
  boolKey('editorHasSelection'),
  boolKey('editorHasMultipleSelections'),
  boolKey('editorTabMovesFocus'),
  boolKey('editorIsOpen'),
  boolKey('editorHoverVisible'),
  boolKey('editorHoverFocused'),
  boolKey('stickyScrollFocused'),
  boolKey('stickyScrollVisible'),
  boolKey('standaloneColorPickerVisible'),
  boolKey('standaloneColorPickerFocused'),
  boolKey('isComposing'),
  boolKey('inCompositeEditor'),
  boolKey('isInEmbeddedEditor'),
  boolKey('editorSimpleInput'),
  // Diff editor
  boolKey('inDiffEditor'),
  boolKey('isEmbeddedDiffEditor'),
  boolKey('inMultiDiffEditor'),
  boolKey('multiDiffEditorAllCollapsed'),
  boolKey('diffEditorHasChanges'),
  boolKey('comparingMovedCode'),
  boolKey('accessibleDiffViewerVisible'),
  boolKey('diffEditorRenderSideBySideInlineBreakpointReached'),
  boolKey('diffEditorInlineMode'),
  boolKey('diffEditorOriginalWritable'),
  boolKey('diffEditorModifiedWritable'),
  // Language-feature providers
  boolKey('editorHasCompletionItemProvider'),
  boolKey('editorHasCodeActionsProvider'),
  boolKey('editorHasCodeLensProvider'),
  boolKey('editorHasDefinitionProvider'),
  boolKey('editorHasDeclarationProvider'),
  boolKey('editorHasImplementationProvider'),
  boolKey('editorHasTypeDefinitionProvider'),
  boolKey('editorHasHoverProvider'),
  boolKey('editorHasDocumentHighlightProvider'),
  boolKey('editorHasDocumentSymbolProvider'),
  boolKey('editorHasReferenceProvider'),
  boolKey('editorHasRenameProvider'),
  boolKey('editorHasSignatureHelpProvider'),
  boolKey('editorHasInlayHintsProvider'),
  boolKey('editorHasDocumentFormattingProvider'),
  boolKey('editorHasDocumentSelectionFormattingProvider'),
  boolKey('editorHasMultipleDocumentFormattingProvider'),
  boolKey('editorHasMultipleDocumentSelectionFormattingProvider'),
  boolKey('editorSelectionHasDiagnostics'),
  // Undo / redo
  boolKey('canUndo'),
  boolKey('canRedo'),
  // Active editor
  boolKey('activeEditorIsDirty'),
  boolKey('activeEditorIsNotPreview'),
  boolKey('activeEditorIsFirstInGroup'),
  boolKey('activeEditorIsLastInGroup'),
  boolKey('activeEditorIsPinned'),
  boolKey('activeEditorIsReadonly'),
  boolKey('activeCompareEditorCanSwap'),
  boolKey('activeEditorCanToggleReadonly'),
  boolKey('activeEditorCanRevert'),
  boolKey('activeEditorCanSplitInGroup'),
  boolKey('textCompareEditorVisible'),
  boolKey('textCompareEditorActive'),
  boolKey('sideBySideEditorActive'),
  boolKey('activeCustomEditorDiffCanToggleLayout'),
  boolKey('activeCustomEditorTextDiff'),
  // Editor groups
  boolKey('isTopRightEditorGroup'),
  boolKey('activeEditorGroupEmpty'),
  boolKey('activeEditorGroupLast'),
  boolKey('activeEditorGroupLocked'),
  boolKey('multipleEditorGroups'),
  boolKey('multipleEditorsSelectedInGroup'),
  boolKey('twoEditorsSelectedInGroup'),
  boolKey('SelectedEditorsInGroupFileOrUntitledResourceContextKey'),
  boolKey('editorPartMultipleEditorGroups'),
  boolKey('editorPartMaximizedEditorGroup'),
  boolKey('editorPartModal'),
  boolKey('editorPartModalMaximized'),
  boolKey('editorPartModalNavigation'),
  boolKey('editorPartModalSidebar'),
  boolKey('editorPartModalSidebarVisible'),
  // Layout
  boolKey('inZenMode'),
  boolKey('isCenteredLayout'),
  boolKey('splitEditorsVertically'),
  boolKey('mainEditorAreaVisible'),
  boolKey('editorTabsVisible'),
  boolKey('sideBarVisible'),
  boolKey('sideBarFocus'),
  boolKey('filesExplorerFocus'),
  boolKey('explorerViewletVisible'),
  boolKey('explorerResourceIsFolder'),
  boolKey('foldersViewVisible'),
  boolKey('searchViewletVisible'),
  boolKey('searchViewletFocus'),
  boolKey('panelFocus'),
  boolKey('panelVisible'),
  boolKey('panelMaximized'),
  boolKey('statusBarFocused'),
  boolKey('titleBarVisible'),
  boolKey('isCompactTitleBar'),
  boolKey('bannerFocused'),
  boolKey('notificationFocus'),
  boolKey('notificationCenterVisible'),
  boolKey('notificationToastsVisible'),
  boolKey('auxiliaryBarFocus'),
  boolKey('auxiliaryBarVisible'),
  boolKey('auxiliaryBarMaximized'),
  // Workspace
  boolKey('dirtyWorkingCopies'),
  boolKey('openFolderWorkspaceSupport'),
  boolKey('enterMultiRootWorkspaceSupport'),
  boolKey('emptyWorkspaceSupport'),
  boolKey('temporaryWorkspace'),
  boolKey('isSessionsWindow'),
  boolKey('hasWebFileSystemAccess'),
  boolKey('inAutomation'),
  // Window / platform
  boolKey('isFullscreen'),
  boolKey('isAuxiliaryWindowFocusedContext'),
  boolKey('isWindowAlwaysOnTop'),
  boolKey('isAuxiliaryWindow'),
  boolKey('isMac'),
  boolKey('isLinux'),
  boolKey('isWindows'),
  boolKey('isWeb'),
  boolKey('isMacNative'),
  boolKey('isIOS'),
  boolKey('isMobile'),
  boolKey('isDevelopment'),
  // Resource
  boolKey('resourceSet'),
  boolKey('isFileSystemResource'),
  // Find / replace widget
  boolKey('findWidgetVisible'),
  boolKey('findInputFocussed'),
  boolKey('replaceInputFocussed'),
  boolKey('findWidgetFocused'),
  // Suggest / completion widget
  boolKey('suggestWidgetVisible'),
  boolKey('suggestWidgetHasFocusedSuggestion'),
  boolKey('suggestWidgetMultipleSuggestions'),
  // Code action / parameter hints / reference peek widgets
  boolKey('codeActionMenuVisible'),
  boolKey('parameterHintsVisible'),
  boolKey('parameterHintsMultipleSignatures'),
  boolKey('referenceSearchVisible'),
  // Lists / trees
  boolKey('listFocus'),
  // Source Control
  // `scmRepository` is a key set on the SCM tree-item context via
  // `ContextKeyExpr.has('scmRepository')` (scmViewPane sets a per-item value);
  // VS Code core, presence-gated, so boolean.
  boolKey('scmRepository'),
  // Notebook
  boolKey('notebookEditorFocused'),
  // Welcome / Getting Started
  boolKey('inWelcome'),
  // Terminal
  boolKey('terminalFocus'),
  boolKey('terminalFocusInAny'),
  boolKey('terminalEditorFocus'),
  boolKey('terminalSuggestWidgetVisible'),
  // Quick open
  boolKey('inQuickOpen'),
  // Accessibility
  boolKey('accessibilityHelpIsShown'),
  boolKey('accessibleViewIsShown'),
  boolKey('accessibleViewSupportsNavigation'),
  boolKey('accessibleViewVerbosityEnabled'),
  boolKey('accessibleViewGoToSymbolSupported'),
  boolKey('accessibleViewOnLastLine'),
  boolKey('accessibleViewInCodeBlock'),
  boolKey('accessibleViewContainsCodeBlocks'),
] as const

// ─── Numeric context keys ─────────────────────────────────────────────────

/** VS Code core context keys whose value domain is a number. */
export const numericContextKeys = [
  numberKey('workspaceFolderCount'),
  numberKey('groupEditorsCount'),
  numberKey('activeEditorGroupIndex'),
] as const

// ─── Closed string context keys ───────────────────────────────────────────
// Genuinely fixed, fully enumerable string domains — `Schema.Literal(...)`.

/** The kind of workspace opened. */
export const workbenchState = ExternalContextKeyDecl({
  name: 'workbenchState',
  valueType: Schema.Literal('empty', 'folder', 'workspace'),
  ownedBy,
})

/** Style of the window title bar (platform + configuration). */
export const titleBarStyle = ExternalContextKeyDecl({
  name: 'titleBarStyle',
  valueType: Schema.Literal('custom', 'native'),
  ownedBy,
})

/** Position of the panel (currently fixed to `bottom`). */
export const panelPosition = ExternalContextKeyDecl({
  name: 'panelPosition',
  valueType: Schema.Literal('bottom'),
  ownedBy,
})

/** Alignment of the panel content. */
export const panelAlignment = ExternalContextKeyDecl({
  name: 'panelAlignment',
  valueType: Schema.Literal('center', 'left', 'right', 'justify'),
  ownedBy,
})

/** VS Code core context keys whose value domain is a closed string literal set. */
export const closedStringContextKeys = [
  workbenchState,
  titleBarStyle,
  panelPosition,
  panelAlignment,
] as const

// ─── Open string context keys ─────────────────────────────────────────────
// Known core membership, extensible at runtime — `OpenEnum(name, members)`.
// `members` seeds the known/autocompletable values; an unmodeled runtime value
// (a new language id, a custom scheme, an extension's view id, …) is still a
// legal `eq` argument via the open-string escape on the authoring projection.

const openEnumKey = <const N extends string, const Members extends Record<string, string>>(
  name: N,
  members: Members,
) => ExternalContextKeyDecl({ name, valueType: OpenEnum(name, members), ownedBy })

// Some open keys have NO known core membership to seed (`resourceFilename`,
// `view`, `viewItem`, …) — their value is an arbitrary runtime string. An
// `OpenEnum` with zero members is degenerate (its closed-member union is
// `never`); the honest model is the open `string` domain. The `When` builder
// treats a `Schema.String` key as an open-string key: `eq` accepts any string
// and `match` (regex) becomes available — exactly right for these.
const stringKey = <const N extends string>(name: N) =>
  ExternalContextKeyDecl({ name, valueType: Schema.String, ownedBy })

/** Language identifier of the active editor (dynamically filled from registered languages). */
export const editorLangId = openEnumKey('editorLangId', {
  typescript: 'typescript',
  javascript: 'javascript',
  typescriptreact: 'typescriptreact',
  javascriptreact: 'javascriptreact',
  json: 'json',
  markdown: 'markdown',
  html: 'html',
  css: 'css',
  python: 'python',
  go: 'go',
  rust: 'rust',
  yaml: 'yaml',
  xml: 'xml',
  java: 'java',
  csharp: 'csharp',
  cpp: 'cpp',
  php: 'php',
  ruby: 'ruby',
  swift: 'swift',
  kotlin: 'kotlin',
  shellscript: 'shellscript',
  dockerfile: 'dockerfile',
  plaintext: 'plaintext',
})

/** Language identifier guessed from the resource (same domain as `editorLangId`). */
export const resourceLangId = openEnumKey('resourceLangId', {
  typescript: 'typescript',
  javascript: 'javascript',
  typescriptreact: 'typescriptreact',
  javascriptreact: 'javascriptreact',
  json: 'json',
  markdown: 'markdown',
  html: 'html',
  css: 'css',
  python: 'python',
  go: 'go',
  rust: 'rust',
  yaml: 'yaml',
  xml: 'xml',
  java: 'java',
  csharp: 'csharp',
  cpp: 'cpp',
  php: 'php',
  ruby: 'ruby',
  swift: 'swift',
  kotlin: 'kotlin',
  shellscript: 'shellscript',
  dockerfile: 'dockerfile',
  plaintext: 'plaintext',
})

/** File extension of the resource (determined by the file system). */
export const resourceExtname = openEnumKey('resourceExtname', {
  '.ts': '.ts',
  '.tsx': '.tsx',
  '.js': '.js',
  '.jsx': '.jsx',
  '.json': '.json',
  '.md': '.md',
  '.html': '.html',
  '.css': '.css',
  '.py': '.py',
  '.go': '.go',
  '.rs': '.rs',
  '.yaml': '.yaml',
  '.yml': '.yml',
  '.xml': '.xml',
})

/** URI scheme of the current resource (extensible by extensions). */
export const resourceScheme = openEnumKey('resourceScheme', {
  file: 'file',
  untitled: 'untitled',
  'vscode-userdata': 'vscode-userdata',
  'vscode-remote': 'vscode-remote',
  'vscode-remote-resource': 'vscode-remote-resource',
  'vscode-managed-remote-resource': 'vscode-managed-remote-resource',
  'vscode-custom-editor': 'vscode-custom-editor',
  'vscode-notebook-cell': 'vscode-notebook-cell',
  'vscode-notebook-metadata': 'vscode-notebook-metadata',
  'vscode-interactive-input': 'vscode-interactive-input',
  'vscode-settings': 'vscode-settings',
  'vscode-workspace-trust': 'vscode-workspace-trust',
  'vscode-terminal': 'vscode-terminal',
  'vscode-image-carousel': 'vscode-image-carousel',
  'vscode-chat-code-block': 'vscode-chat-code-block',
  'vscode-chat-editor': 'vscode-chat-editor',
  http: 'http',
  https: 'https',
  data: 'data',
  command: 'command',
  inmemory: 'inmemory',
  'webview-panel': 'webview-panel',
})

/** File name of the resource (basename) — open by file system. */
export const resourceFilename = stringKey('resourceFilename')

/** Folder name containing the resource — open by file system hierarchy. */
export const resourceDirname = stringKey('resourceDirname')

/** Full path of the resource — open by file system. */
export const resourcePath = stringKey('resourcePath')

/** Identifier of the active viewlet (sidebar container) — extensible by extensions. */
export const activeViewlet = openEnumKey('activeViewlet', {
  explorer: 'workbench.view.explorer',
  search: 'workbench.view.search',
  scm: 'workbench.view.scm',
  debug: 'workbench.view.debug',
  extensions: 'workbench.view.extensions',
})

/** Identifier of the active panel — extensible by extensions. */
export const activePanel = openEnumKey('activePanel', {
  terminal: 'terminal',
  output: 'output',
  problems: 'problems',
  debugConsole: 'debug.console',
  ports: 'ports',
  comments: 'comments',
})

/** viewType of the currently active custom editor — extensible by extensions. */
export const activeCustomEditorId = openEnumKey('activeCustomEditorId', {
  markdownPreview: 'vscode.markdown.preview.editor',
})

/** viewType of the currently active webview panel — extensible by extensions. */
export const activeWebviewPanelId = stringKey('activeWebviewPanelId')

/** Identifier of the view that has keyboard focus — extensible by extensions. */
export const focusedView = openEnumKey('focusedView', {
  explorerFileView: 'workbench.explorer.fileView',
})

/** Identifier of the current view context in a TreeView — dynamic by view id. */
export const view = stringKey('view')

/** Context value of a tree view item — set by the data provider. */
export const viewItem = stringKey('viewItem')

/** Name of the remote the window is connected to (empty if not remote). */
export const remoteName = stringKey('remoteName')

/** Scheme of the current workspace if it is from a virtual file system. */
export const virtualWorkspace = stringKey('virtualWorkspace')

/** Quality type of VS Code — determined by the product service. */
export const productQualityType = openEnumKey('productQualityType', {
  stable: 'stable',
  insiders: 'insiders',
  exploration: 'exploration',
  dev: 'dev',
})

/** Identifier of the embedder according to the product service. */
export const embedderIdentifier = stringKey('embedderIdentifier')

/**
 * VS Code core context keys with a known core membership that stays open to
 * runtime-registered values — `OpenEnum(name, members)`. The known members
 * autocomplete on `eq` while an unmodeled value is still accepted.
 */
export const openEnumContextKeys = [
  editorLangId,
  resourceLangId,
  resourceExtname,
  resourceScheme,
  activeViewlet,
  activePanel,
  activeCustomEditorId,
  focusedView,
  productQualityType,
] as const

/**
 * VS Code core context keys whose value is an arbitrary runtime string with no
 * enumerable core membership — `Schema.String`. The `When` builder treats these
 * as open-string keys (any-string `eq`, `match` regex available).
 */
export const plainStringContextKeys = [
  resourceFilename,
  resourceDirname,
  resourcePath,
  activeWebviewPanelId,
  view,
  viewItem,
  remoteName,
  virtualWorkspace,
  embedderIdentifier,
] as const

/** All open-domain (non-closed) string context keys — OpenEnum-backed + plain string. */
export const openStringContextKeys = [...openEnumContextKeys, ...plainStringContextKeys] as const

// ─── Full catalog ─────────────────────────────────────────────────────────

/**
 * The complete catalog of VS Code **core** context keys as
 * `ExternalContextKeyDecl`s — boolean, numeric, closed-string, and open-string
 * domains combined. Seed `defineManifest({ externalContextKeys: [...] })` with
 * this (spread the literal arrays so the const tuple shape survives for the
 * `When` builder's key/value inference).
 */
export const coreContextKeys = [
  ...booleanContextKeys,
  ...numericContextKeys,
  ...closedStringContextKeys,
  ...openStringContextKeys,
] as const
