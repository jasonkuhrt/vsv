// vsv vscode-mock — bun:test fixture replacement for the `vscode` module.
//
// Surface goals:
//   1. Cover the API shapes real consumer extensions reach for (commands,
//      configuration with per-target inspect, editor surfaces, tabGroups,
//      workspace edits, status bar messages, input box).
//   2. Be observable: every recordable state lives on `__state` so tests can
//      assert on it directly.
//   3. Be settable: tests can pre-seed editor content, tab layout, input-box
//      results, configuration values, etc.
//
// Fidelity is intentionally minimal — these mocks behave correctly enough that
// extension code flows through them, but they are not a reimplementation of
// VSCode's API. Tests should assert on recorded calls and post-state, not on
// behavioral edge cases.

// ─────────────────────────────────────────────────────────────────────────────
// Value types: Position, Range, Selection, Uri, WorkspaceEdit, TextDocument
// ─────────────────────────────────────────────────────────────────────────────

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}

  isBefore(other: Position): boolean {
    if (this.line !== other.line) return this.line < other.line
    return this.character < other.character
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character
  }

  translate(lineDelta = 0, characterDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta)
  }
}

export class Range {
  readonly start: Position
  readonly end: Position

  constructor(start: Position, end: Position)
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number)
  constructor(
    startOrLine: Position | number,
    endOrChar: Position | number,
    endLine?: number,
    endChar?: number,
  ) {
    if (startOrLine instanceof Position) {
      this.start = startOrLine
      this.end = endOrChar as Position
    } else {
      this.start = new Position(startOrLine, endOrChar as number)
      this.end = new Position(endLine ?? 0, endChar ?? 0)
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end)
  }

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      return !positionOrRange.isBefore(this.start) && !this.end.isBefore(positionOrRange)
    }
    return this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
  }
}

export class Selection extends Range {
  constructor(
    public readonly anchor: Position,
    public readonly active: Position,
  ) {
    super(
      anchor.isBefore(active) || anchor.isEqual(active) ? anchor : active,
      anchor.isBefore(active) || anchor.isEqual(active) ? active : anchor,
    )
  }
}

export class Uri {
  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}

  // For `file:` scheme this matches VSCode's behavior of stripping the scheme
  // and authority and returning the raw path. For other schemes we return the
  // raw path; consumer code that filters on `scheme !== 'file'` handles those.
  get fsPath(): string {
    return this.path
  }

  static parse(value: string): Uri {
    // scheme:[//authority]path[?query][#fragment] — minimal RFC-3986-shaped parse
    const m = /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(
      value,
    )
    if (!m) return new Uri('file', '', value, '', '')
    const [, scheme = '', authority = '', path = '', query = '', fragment = ''] = m
    return new Uri(scheme.toLowerCase(), authority, path, query, fragment)
  }

  static file(path: string): Uri {
    return new Uri('file', '', path, '', '')
  }

  toString(): string {
    let result = `${this.scheme}:`
    if (this.scheme === 'file' || this.authority) {
      result += `//${this.authority}`
    }
    result += this.path
    if (this.query) result += `?${this.query}`
    if (this.fragment) result += `#${this.fragment}`
    return result
  }

  with(change: {
    scheme?: string
    authority?: string
    path?: string
    query?: string
    fragment?: string
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    )
  }
}

interface TextEdit {
  range: Range
  newText: string
}

export class WorkspaceEdit {
  private readonly operations: Array<{ uri: Uri; edit: TextEdit }> = []

  replace(uri: Uri, range: Range, newText: string): void {
    this.operations.push({ uri, edit: { range, newText } })
  }

  insert(uri: Uri, position: Position, newText: string): void {
    this.operations.push({ uri, edit: { range: new Range(position, position), newText } })
  }

  delete(uri: Uri, range: Range): void {
    this.operations.push({ uri, edit: { range, newText: '' } })
  }

  has(uri: Uri): boolean {
    return this.operations.some((o) => o.uri.toString() === uri.toString())
  }

  get size(): number {
    return new Set(this.operations.map((o) => o.uri.toString())).size
  }

  // VSCode returns `[Uri, TextEdit[]]` pairs grouped per-uri. A file with
  // multiple operations appears once with all its TextEdits in one array.
  entries(): Array<[Uri, TextEdit[]]> {
    const grouped = new Map<string, { uri: Uri; edits: TextEdit[] }>()
    for (const op of this.operations) {
      const key = op.uri.toString()
      const existing = grouped.get(key)
      if (existing) existing.edits.push(op.edit)
      else grouped.set(key, { uri: op.uri, edits: [op.edit] })
    }
    return [...grouped.values()].map(({ uri, edits }) => [uri, edits])
  }

  // Internal: read all operations in insertion order. Used by applyEdit.
  __operations(): ReadonlyArray<{ uri: Uri; edit: TextEdit }> {
    return this.operations
  }
}

interface TextLine {
  text: string
  range: Range
}

interface TextDocument {
  uri: Uri
  readonly lineCount: number
  getText(range?: Range): string
  getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined
  lineAt(line: number): TextLine
}

interface InternalTextDocument extends TextDocument {
  __setText: (text: string) => void
}

const computeOffset = (text: string, position: Position): number => {
  // Walk the text counting characters until we hit `position.line` newlines.
  let line = 0
  let char = 0
  for (let i = 0; i < text.length; i++) {
    if (line === position.line && char === position.character) return i
    if (text[i] === '\n') {
      if (line === position.line) {
        // Position is past end-of-line; clamp.
        return i
      }
      line++
      char = 0
    } else {
      char++
    }
  }
  return text.length
}

const createMockTextDocument = (uri: Uri, initial: string): InternalTextDocument => {
  let text = initial
  const doc: InternalTextDocument = {
    uri,
    get lineCount(): number {
      return text.split('\n').length
    },
    getText: (range?: Range): string => {
      if (!range) return text
      return text.slice(computeOffset(text, range.start), computeOffset(text, range.end))
    },
    getWordRangeAtPosition: (position: Position, regex?: RegExp): Range | undefined => {
      const lines = text.split('\n')
      const line = lines[position.line]
      if (line === undefined) return undefined
      // Ensure global flag so we can iterate matches.
      const source = regex ?? /[a-zA-Z_$][a-zA-Z0-9_$]*/
      const flags = source.flags.includes('g') ? source.flags : `${source.flags}g`
      const rx = new RegExp(source.source, flags)
      let match: RegExpExecArray | null
      while ((match = rx.exec(line)) !== null) {
        const start = match.index
        const end = start + match[0].length
        if (position.character >= start && position.character <= end) {
          return new Range(new Position(position.line, start), new Position(position.line, end))
        }
        if (rx.lastIndex === match.index) rx.lastIndex++ // safety against zero-width loops
      }
      return undefined
    },
    lineAt: (lineNumber: number): TextLine => {
      const lines = text.split('\n')
      const lineText = lines[lineNumber] ?? ''
      return {
        text: lineText,
        range: new Range(new Position(lineNumber, 0), new Position(lineNumber, lineText.length)),
      }
    },
    __setText: (s: string): void => {
      text = s
    },
  }
  return doc
}

interface TextEditor {
  document: TextDocument
  selection: Selection
}

interface MockTab {
  label: string
  isPinned: boolean
}

interface MockTabGroup {
  tabs: MockTab[]
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

type CommandHandler = (...args: unknown[]) => unknown

interface ExecutedCommand {
  id: string
  args: unknown[]
}

interface ConfigurationChange {
  section: string
  key: string
  value: unknown
  target: number
}

interface ConfigurationEntry {
  defaultValue?: unknown
  globalValue?: unknown
  workspaceValue?: unknown
  workspaceFolderValue?: unknown
}

interface StatusBarMessage {
  message: string
  hideAfterTimeout: number | undefined
}

// FileType — VSCode's bitmask: Unknown=0, File=1, Directory=2, SymbolicLink=64.
export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const
export type FileType = (typeof FileType)[keyof typeof FileType]

export interface FileStat {
  type: FileType
  ctime: number
  mtime: number
  size: number
}

interface UpdateFoldersCall {
  start: number
  deleteCount: number | null | undefined
  adds: ReadonlyArray<{ uri: Uri; name?: string }>
}

interface OpenDialogOptionsRecord {
  defaultUri?: Uri
  openLabel?: string
  canSelectFiles?: boolean
  canSelectFolders?: boolean
  canSelectMany?: boolean
  filters?: { readonly [name: string]: ReadonlyArray<string> }
  title?: string
}

interface MockState {
  registeredCommands: Map<string, CommandHandler>
  executedCommands: ExecutedCommand[]
  contextKeys: Map<string, unknown>
  configuration: Map<string, ConfigurationEntry>
  configurationChanges: ConfigurationChange[]
  shownQuickPicks: unknown[]
  nextQuickPickResult: unknown
  shownInputBoxes: Array<{ options: unknown }>
  nextInputBoxResult: string | undefined
  shownMessages: Array<{ level: 'info' | 'warn' | 'error'; message: string }>
  statusBarMessages: StatusBarMessage[]
  tabGroups: MockTabGroup[]
  closedTabs: MockTab[]
  documents: Map<string, InternalTextDocument>
  appliedEdits: WorkspaceEdit[]
  activeTextEditor: TextEditor | undefined
  clipboard: string
  workspaceFolders: WorkspaceFolder[] | undefined
  fsEntries: Map<string, ReadonlyArray<[string, FileType]>>
  fsStats: Map<string, FileStat>
  fsRealpath: Map<string, string | Error>
  updateFoldersCalls: UpdateFoldersCall[]
  nextUpdateFoldersResult: boolean
  shownOpenDialogs: Array<{ options: OpenDialogOptionsRecord }>
  nextOpenDialogResult: readonly Uri[] | undefined
}

export interface WorkspaceFolder {
  uri: Uri
  name: string
  index: number
}

const state: MockState = {
  registeredCommands: new Map(),
  executedCommands: [],
  contextKeys: new Map(),
  configuration: new Map(),
  configurationChanges: [],
  shownQuickPicks: [],
  nextQuickPickResult: undefined,
  shownInputBoxes: [],
  nextInputBoxResult: undefined,
  shownMessages: [],
  statusBarMessages: [],
  tabGroups: [],
  closedTabs: [],
  documents: new Map(),
  appliedEdits: [],
  activeTextEditor: undefined,
  clipboard: '',
  workspaceFolders: undefined,
  fsEntries: new Map(),
  fsStats: new Map(),
  fsRealpath: new Map(),
  updateFoldersCalls: [],
  nextUpdateFoldersResult: true,
  shownOpenDialogs: [],
  nextOpenDialogResult: undefined,
}

const mergedConfigValue = (entry: ConfigurationEntry): unknown => {
  if (entry.workspaceFolderValue !== undefined) return entry.workspaceFolderValue
  if (entry.workspaceValue !== undefined) return entry.workspaceValue
  if (entry.globalValue !== undefined) return entry.globalValue
  if (entry.defaultValue !== undefined) return entry.defaultValue
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// commands
// ─────────────────────────────────────────────────────────────────────────────

export const commands = {
  registerCommand: (id: string, handler: CommandHandler) => {
    state.registeredCommands.set(id, handler)
    return {
      dispose: () => {
        state.registeredCommands.delete(id)
      },
    }
  },
  executeCommand: async (id: string, ...args: unknown[]): Promise<unknown> => {
    state.executedCommands.push({ id, args })
    if (id === 'setContext') {
      const key = args[0]
      const value = args[1]
      if (typeof key === 'string') {
        state.contextKeys.set(key, value)
      }
      return undefined
    }
    const handler = state.registeredCommands.get(id)
    if (handler) {
      return await handler(...args)
    }
    return undefined
  },
  getCommands: async (_filterInternal?: boolean): Promise<string[]> => {
    return Array.from(state.registeredCommands.keys())
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// workspace
// ─────────────────────────────────────────────────────────────────────────────

interface ConfigurationInspection<T> {
  key: string
  defaultValue?: T
  globalValue?: T
  workspaceValue?: T
  workspaceFolderValue?: T
}

interface WorkspaceConfiguration {
  get: <T>(key: string, defaultValue?: T) => T | undefined
  has: (key: string) => boolean
  update: (key: string, value: unknown, target?: number) => Promise<void>
  inspect: <T>(key: string) => ConfigurationInspection<T> | undefined
}

export const workspace = {
  get workspaceFolders(): readonly WorkspaceFolder[] | undefined {
    return state.workspaceFolders
  },
  getConfiguration: (section?: string): WorkspaceConfiguration => {
    const prefix = section === undefined ? '' : `${section}.`
    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        const fullKey = `${prefix}${key}`
        const entry = state.configuration.get(fullKey)
        if (!entry) return defaultValue
        const merged = mergedConfigValue(entry)
        return (merged === undefined ? defaultValue : merged) as T | undefined
      },
      has: (key: string): boolean => state.configuration.has(`${prefix}${key}`),
      update: async (key: string, value: unknown, target?: number): Promise<void> => {
        const fullKey = `${prefix}${key}`
        const entry: ConfigurationEntry = state.configuration.get(fullKey) ?? {}
        const tgt = target ?? ConfigurationTarget.Workspace
        if (tgt === ConfigurationTarget.Global) entry.globalValue = value
        else if (tgt === ConfigurationTarget.Workspace) entry.workspaceValue = value
        else if (tgt === ConfigurationTarget.WorkspaceFolder) entry.workspaceFolderValue = value
        state.configuration.set(fullKey, entry)
        state.configurationChanges.push({ section: section ?? '', key, value, target: tgt })
      },
      inspect: <T>(key: string): ConfigurationInspection<T> | undefined => {
        const fullKey = `${prefix}${key}`
        const entry = state.configuration.get(fullKey)
        if (!entry) return undefined
        // Build the inspection conditionally so `exactOptionalPropertyTypes`
        // doesn't see an explicit `undefined` value for an optional field.
        const out: ConfigurationInspection<T> = { key: fullKey }
        if (entry.defaultValue !== undefined) out.defaultValue = entry.defaultValue as T
        if (entry.globalValue !== undefined) out.globalValue = entry.globalValue as T
        if (entry.workspaceValue !== undefined) out.workspaceValue = entry.workspaceValue as T
        if (entry.workspaceFolderValue !== undefined) {
          out.workspaceFolderValue = entry.workspaceFolderValue as T
        }
        return out
      },
    }
  },
  onDidChangeConfiguration: (_listener: (e: unknown) => unknown) => {
    return { dispose: () => {} }
  },
  onDidChangeWorkspaceFolders: (_listener: (e: unknown) => unknown) => {
    return { dispose: () => {} }
  },
  openTextDocument: async (target: Uri | string): Promise<TextDocument> => {
    const uri = typeof target === 'string' ? Uri.file(target) : target
    const key = uri.toString()
    const existing = state.documents.get(key)
    if (existing) return existing
    // Documents that haven't been pre-seeded come back empty — tests should
    // seed via __state.openDocument() before invoking code that opens them.
    const doc = createMockTextDocument(uri, '')
    state.documents.set(key, doc)
    return doc
  },
  fs: {
    readDirectory: async (uri: Uri): Promise<ReadonlyArray<[string, FileType]>> => {
      const entries = state.fsEntries.get(uri.fsPath)
      if (!entries) {
        const err = new Error(`ENOENT: ${uri.fsPath}`)
        ;(err as { code?: string }).code = 'FileNotFound'
        throw err
      }
      return entries
    },
    stat: async (uri: Uri): Promise<FileStat> => {
      const stat = state.fsStats.get(uri.fsPath)
      if (!stat) {
        const err = new Error(`ENOENT: ${uri.fsPath}`)
        ;(err as { code?: string }).code = 'FileNotFound'
        throw err
      }
      return stat
    },
  },
  applyEdit: async (edit: WorkspaceEdit): Promise<boolean> => {
    state.appliedEdits.push(edit)
    for (const [uri, edits] of edit.entries()) {
      const doc = state.documents.get(uri.toString())
      if (!doc) continue
      // Apply earlier-in-buffer edits last so they don't shift the offsets of
      // later-in-buffer edits. Sort descending by start position.
      const sorted = [...edits].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line)
          return b.range.start.line - a.range.start.line
        return b.range.start.character - a.range.start.character
      })
      let text = doc.getText()
      for (const e of sorted) {
        const startOffset = computeOffset(text, e.range.start)
        const endOffset = computeOffset(text, e.range.end)
        text = text.slice(0, startOffset) + e.newText + text.slice(endOffset)
      }
      doc.__setText(text)
    }
    return true
  },
  updateWorkspaceFolders: (
    start: number,
    deleteCount: number | null | undefined,
    ...adds: ReadonlyArray<{ readonly uri: Uri; readonly name?: string }>
  ): boolean => {
    state.updateFoldersCalls.push({
      start,
      deleteCount,
      adds: adds.map((a) => (a.name === undefined ? { uri: a.uri } : { uri: a.uri, name: a.name })),
    })
    return state.nextUpdateFoldersResult
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// window
// ─────────────────────────────────────────────────────────────────────────────

interface InputBoxOptions {
  prompt?: string
  value?: string
  valueSelection?: [number, number]
  placeHolder?: string
}

const tabGroupsApi = {
  get all(): readonly MockTabGroup[] {
    return state.tabGroups
  },
  close: async (tabsToClose: MockTab | readonly MockTab[]): Promise<boolean> => {
    const list: readonly MockTab[] = Array.isArray(tabsToClose)
      ? (tabsToClose as readonly MockTab[])
      : [tabsToClose as MockTab]
    for (const t of list) state.closedTabs.push(t)
    for (const group of state.tabGroups) {
      group.tabs = group.tabs.filter((t) => !list.includes(t))
    }
    return true
  },
}

export const window = {
  showQuickPick: async (items: unknown, opts?: unknown): Promise<unknown> => {
    state.shownQuickPicks.push({ items, opts })
    return state.nextQuickPickResult
  },
  showInputBox: async (options?: InputBoxOptions): Promise<string | undefined> => {
    state.shownInputBoxes.push({ options })
    return state.nextInputBoxResult
  },
  showInformationMessage: async (
    message: string,
    ..._items: string[]
  ): Promise<string | undefined> => {
    state.shownMessages.push({ level: 'info', message })
    return undefined
  },
  showWarningMessage: async (message: string, ..._items: string[]): Promise<string | undefined> => {
    state.shownMessages.push({ level: 'warn', message })
    return undefined
  },
  showErrorMessage: async (message: string, ..._items: string[]): Promise<string | undefined> => {
    state.shownMessages.push({ level: 'error', message })
    return undefined
  },
  setStatusBarMessage: (message: string, hideAfterTimeout?: number) => {
    state.statusBarMessages.push({ message, hideAfterTimeout })
    return { dispose: (): void => {} }
  },
  showOpenDialog: async (
    options?: OpenDialogOptionsRecord,
  ): Promise<readonly Uri[] | undefined> => {
    // Snapshot the options object so later mutation by the caller doesn't
    // retroactively alter recorded test state.
    const recorded: OpenDialogOptionsRecord = {}
    if (options?.defaultUri !== undefined) recorded.defaultUri = options.defaultUri
    if (options?.openLabel !== undefined) recorded.openLabel = options.openLabel
    if (options?.canSelectFiles !== undefined) recorded.canSelectFiles = options.canSelectFiles
    if (options?.canSelectFolders !== undefined)
      recorded.canSelectFolders = options.canSelectFolders
    if (options?.canSelectMany !== undefined) recorded.canSelectMany = options.canSelectMany
    if (options?.filters !== undefined) recorded.filters = options.filters
    if (options?.title !== undefined) recorded.title = options.title
    state.shownOpenDialogs.push({ options: recorded })
    return state.nextOpenDialogResult
  },
  get activeTextEditor(): TextEditor | undefined {
    return state.activeTextEditor
  },
  tabGroups: tabGroupsApi,
}

// ─────────────────────────────────────────────────────────────────────────────
// disposables / events
// ─────────────────────────────────────────────────────────────────────────────

type EventListener<T> = (value: T) => unknown

export class EventEmitter<T> {
  private listeners = new Set<EventListener<T>>()

  readonly event = (listener: EventListener<T>) => {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}

export class Disposable {
  constructor(public callOnDispose: () => void) {}

  dispose(): void {
    this.callOnDispose()
  }

  static from(...disposables: Array<{ dispose: () => void }>): Disposable {
    return new Disposable(() => {
      for (const d of disposables) {
        d.dispose()
      }
    })
  }
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const

// ─────────────────────────────────────────────────────────────────────────────
// env — process/host-level surfaces
// ─────────────────────────────────────────────────────────────────────────────

export const env = {
  clipboard: {
    readText: async (): Promise<string> => state.clipboard,
    writeText: async (text: string): Promise<void> => {
      state.clipboard = text
    },
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// __state — observable + settable knobs for tests
// ─────────────────────────────────────────────────────────────────────────────

export const __state = {
  reset: (): void => {
    state.registeredCommands.clear()
    state.executedCommands = []
    state.contextKeys.clear()
    state.configuration.clear()
    state.configurationChanges = []
    state.shownQuickPicks = []
    state.nextQuickPickResult = undefined
    state.shownInputBoxes = []
    state.nextInputBoxResult = undefined
    state.shownMessages = []
    state.statusBarMessages = []
    state.tabGroups = []
    state.closedTabs = []
    state.documents.clear()
    state.appliedEdits = []
    state.activeTextEditor = undefined
    state.clipboard = ''
    state.workspaceFolders = undefined
    state.fsEntries.clear()
    state.fsStats.clear()
    state.fsRealpath.clear()
    state.updateFoldersCalls = []
    state.nextUpdateFoldersResult = true
    state.shownOpenDialogs = []
    state.nextOpenDialogResult = undefined
  },

  // Filesystem (mock)
  setFsDirectory: (path: string, entries: ReadonlyArray<[string, FileType]>): void => {
    state.fsEntries.set(path, entries)
    state.fsStats.set(path, { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 })
  },
  setFsStat: (path: string, stat: FileStat): void => {
    state.fsStats.set(path, stat)
  },

  // Clipboard
  getClipboard: (): string => state.clipboard,
  setClipboard: (text: string): void => {
    state.clipboard = text
  },

  // Workspace folders
  setWorkspaceFolders: (folders: ReadonlyArray<{ uri: Uri; name?: string }>): void => {
    state.workspaceFolders = folders.map((f, index) => ({
      uri: f.uri,
      name: f.name ?? f.uri.fsPath.split('/').pop() ?? '',
      index,
    }))
  },

  // Commands
  getRegisteredCommands: (): string[] => Array.from(state.registeredCommands.keys()),
  getExecutedCommands: (): ReadonlyArray<ExecutedCommand> => [...state.executedCommands],

  // Context keys
  getContextKeys: (): Readonly<Record<string, unknown>> => Object.fromEntries(state.contextKeys),
  setContextKey: (key: string, value: unknown): void => {
    state.contextKeys.set(key, value)
  },

  // Configuration — setConfiguration writes to globalValue (the natural target
  // for "this is the user's setting"). For per-target seeding, use
  // setConfigurationDetail.
  getConfiguration: (): Readonly<Record<string, unknown>> => {
    const out: Record<string, unknown> = {}
    for (const [k, entry] of state.configuration) {
      const merged = mergedConfigValue(entry)
      if (merged !== undefined) out[k] = merged
    }
    return out
  },
  getConfigurationChanges: (): ReadonlyArray<ConfigurationChange> => [
    ...state.configurationChanges,
  ],
  setConfiguration: (entries: Readonly<Record<string, unknown>>): void => {
    for (const [k, v] of Object.entries(entries)) {
      const entry: ConfigurationEntry = state.configuration.get(k) ?? {}
      entry.globalValue = v
      state.configuration.set(k, entry)
    }
  },
  setConfigurationDetail: (key: string, detail: ConfigurationEntry): void => {
    state.configuration.set(key, { ...state.configuration.get(key), ...detail })
  },
  inspectConfiguration: (key: string): ConfigurationEntry | undefined => {
    const entry = state.configuration.get(key)
    if (!entry) return undefined
    return { ...entry }
  },

  // Quick picks
  getShownQuickPicks: (): ReadonlyArray<unknown> => [...state.shownQuickPicks],
  setNextQuickPickResult: (value: unknown): void => {
    state.nextQuickPickResult = value
  },

  // Input box
  getShownInputBoxes: (): ReadonlyArray<{ options: unknown }> => [...state.shownInputBoxes],
  setNextInputBoxResult: (value: string | undefined): void => {
    state.nextInputBoxResult = value
  },

  // Messages
  getShownMessages: (): ReadonlyArray<{ level: 'info' | 'warn' | 'error'; message: string }> => [
    ...state.shownMessages,
  ],

  // Status bar
  getStatusBarMessages: (): ReadonlyArray<StatusBarMessage> => [...state.statusBarMessages],

  // Tab groups
  getTabGroups: (): ReadonlyArray<MockTabGroup> => state.tabGroups,
  getClosedTabs: (): ReadonlyArray<MockTab> => [...state.closedTabs],
  setTabGroups: (groups: ReadonlyArray<{ tabs: ReadonlyArray<MockTab> }>): void => {
    state.tabGroups = groups.map((g) => ({ tabs: [...g.tabs] }))
  },
  setTabs: (tabs: ReadonlyArray<MockTab>): void => {
    state.tabGroups = [{ tabs: [...tabs] }]
  },

  // Documents + editor
  getDocuments: (): ReadonlyArray<TextDocument> => [...state.documents.values()],
  getAppliedEdits: (): ReadonlyArray<WorkspaceEdit> => [...state.appliedEdits],
  openDocument: (uri: Uri | string, content: string): TextDocument => {
    const u = typeof uri === 'string' ? Uri.parse(uri) : uri
    const doc = createMockTextDocument(u, content)
    state.documents.set(u.toString(), doc)
    return doc
  },
  setActiveTextEditor: (editor: TextEditor | undefined): void => {
    state.activeTextEditor = editor
  },
  setActiveCursor: (
    uri: Uri | string,
    content: string,
    cursor: Position | { line: number; character: number },
  ): TextDocument => {
    const u = typeof uri === 'string' ? Uri.parse(uri) : uri
    const doc = createMockTextDocument(u, content)
    state.documents.set(u.toString(), doc)
    const pos = cursor instanceof Position ? cursor : new Position(cursor.line, cursor.character)
    state.activeTextEditor = { document: doc, selection: new Selection(pos, pos) }
    return doc
  },

  // Workspace folder splice — recorded calls + seedable result
  getUpdateFolderCalls: (): ReadonlyArray<UpdateFoldersCall> => [...state.updateFoldersCalls],
  setNextUpdateFoldersResult: (result: boolean): void => {
    state.nextUpdateFoldersResult = result
  },

  // Open dialog — recorded calls + seedable result
  getOpenDialogCalls: (): ReadonlyArray<{ options: OpenDialogOptionsRecord }> => [
    ...state.shownOpenDialogs,
  ],
  setNextOpenDialogResult: (result: readonly Uri[] | undefined): void => {
    state.nextOpenDialogResult = result
  },
}
