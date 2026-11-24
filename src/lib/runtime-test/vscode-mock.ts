import { Effect, Schema, Array, Record, String } from 'effect';
import type * as vscode from 'vscode';
import { VSCodeHostError } from '../runtime/vscode-host.ts';
import type { HostEffect } from '../runtime/vscode-host.ts';
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
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }

  isBefore(other: Position): boolean {
    if (this.line !== other.line) return this.line < other.line;
    return this.character < other.character;
  }

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  isBeforeOrEqual(other: vscode.Position): boolean {
    return this.compareTo(other) <= 0;
  }

  isAfter(other: vscode.Position): boolean {
    return this.compareTo(other) > 0;
  }

  isAfterOrEqual(other: vscode.Position): boolean {
    return this.compareTo(other) >= 0;
  }

  compareTo(other: vscode.Position): number {
    return this.line === other.line
      ? this.character - other.character
      : this.line - other.line;
  }

  translate(
    delta: number | { lineDelta?: number; characterDelta?: number } = 0,
    characterDelta = 0,
  ): Position {
    return typeof delta === 'number'
      ? new Position(this.line + delta, this.character + characterDelta)
      : this.translate(delta.lineDelta, delta.characterDelta);
  }

  with(
    change: number | { line?: number; character?: number } = this.line,
    character = this.character,
  ): Position {
    return typeof change === 'number'
      ? new Position(change, character)
      : this.with(change.line, change.character);
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  );
  constructor(
    startOrLine: Position | number,
    endOrChar: Position | number,
    endLine?: number,
    endChar?: number,
  ) {
    if (typeof startOrLine !== 'number') {
      this.start = startOrLine;
      this.end =
        typeof endOrChar === 'number'
          ? new Position(startOrLine.line, endOrChar)
          : endOrChar;
    } else {
      this.start = new Position(
        startOrLine,
        typeof endOrChar === 'number' ? endOrChar : endOrChar.character,
      );
      this.end = new Position(endLine ?? 0, endChar ?? 0);
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }

  contains(positionOrRange: Position | Range): boolean {
    if ('character' in positionOrRange) {
      return (
        !positionOrRange.isBefore(this.start) &&
        !this.end.isBefore(positionOrRange)
      );
    }
    return (
      this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
    );
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }

  isEqual(other: vscode.Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }

  intersection(other: vscode.Range): Range | undefined {
    const start = this.start.isAfter(other.start) ? this.start : other.start;
    const end = this.end.isBefore(other.end) ? this.end : other.end;
    return start.isAfter(end) ? undefined : new Range(start, end);
  }

  union(other: vscode.Range): Range {
    return new Range(
      this.start.isBefore(other.start) ? this.start : other.start,
      this.end.isAfter(other.end) ? this.end : other.end,
    );
  }

  with(
    change:
      | vscode.Position
      | { start?: vscode.Position; end?: vscode.Position } = this.start,
    end = this.end,
  ): Range {
    return 'character' in change
      ? new Range(change, end)
      : new Range(change.start ?? this.start, change.end ?? this.end);
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position) {
    super(
      anchor.isBefore(active) || anchor.isEqual(active) ? anchor : active,
      anchor.isBefore(active) || anchor.isEqual(active) ? active : anchor,
    );
    this.anchor = anchor;
    this.active = active;
  }

  get isReversed(): boolean {
    return this.anchor.isAfter(this.active);
  }
}

export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(
    scheme: string,
    authority: string,
    path: string,
    query: string,
    fragment: string,
  ) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  // For `file:` scheme this matches VSCode's behavior of stripping the scheme
  // and authority and returning the raw path. For other schemes we return the
  // raw path; consumer code that filters on `scheme !== 'file'` handles those.
  get fsPath(): string {
    return this.path;
  }

  static parse(value: string): Uri {
    // scheme:[//authority]path[?query][#fragment] — minimal RFC-3986-shaped parse
    const m =
      /^([a-z][a-z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/i.exec(
        value,
      );
    if (m === null) return new Uri('file', '', value, '', '');
    const [
      ,
      scheme = '',
      authority = '',
      path = '',
      query = '',
      fragment = '',
    ] = m;
    return new Uri(
      String.toLowerCase(scheme),
      authority,
      path,
      query,
      fragment,
    );
  }

  static file(path: string): Uri {
    return new Uri('file', '', path, '', '');
  }

  toString(): string {
    let result = `${this.scheme}:`;
    if (this.scheme === 'file' || this.authority !== '') {
      result += `//${this.authority}`;
    }
    result += this.path;
    if (this.query !== '') result += `?${this.query}`;
    if (this.fragment !== '') result += `#${this.fragment}`;
    return result;
  }

  toJSON() {
    const { scheme, authority, path, query, fragment } = this;
    return { scheme, authority, path, query, fragment };
  }

  with(change: {
    scheme?: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }
}

interface TextEdit {
  range: Range;
  newText: string;
}

class UnsupportedWorkspaceEdit extends Schema.TaggedError<
  UnsupportedWorkspaceEdit,
  {}
>()('UnsupportedWorkspaceEdit', { operation: Schema.String }) {}

const unsupportedWorkspaceEdit = (operation: string): never =>
  Effect.runSync(Effect.die(UnsupportedWorkspaceEdit.make({ operation })));

export class WorkspaceEdit {
  private readonly operations: Array<{ uri: Uri; edit: TextEdit }> = [];

  replace(uri: Uri, range: Range, newText: string): void {
    this.operations.push({ uri, edit: { range, newText } });
  }

  insert(uri: Uri, position: Position, newText: string): void {
    this.operations.push({
      uri,
      edit: { range: new Range(position, position), newText },
    });
  }

  delete(uri: Uri, range: Range): void {
    this.operations.push({ uri, edit: { range, newText: '' } });
  }

  has(uri: Uri): boolean {
    return Array.some(
      this.operations,
      (o) => o.uri.toString() === uri.toString(),
    );
  }

  get size(): number {
    return new Set(Array.map(this.operations, (o) => o.uri.toString())).size;
  }

  // VSCode returns `[Uri, TextEdit[]]` pairs grouped per-uri. A file with
  // multiple operations appears once with all its TextEdits in one array.
  entries(): Array<[Uri, TextEdit[]]> {
    const grouped = new Map<string, { uri: Uri; edits: TextEdit[] }>();
    for (const op of this.operations) {
      const key = op.uri.toString();
      const existing = grouped.get(key);
      if (existing !== undefined) existing.edits.push(op.edit);
      else grouped.set(key, { uri: op.uri, edits: [op.edit] });
    }
    return Array.map([...grouped.values()], ({ uri, edits }) => [uri, edits]);
  }

  get(uri: Uri): Array<TextEdit> {
    const edits = Array.filter(
      this.operations,
      (op) => op.uri.toString() === uri.toString(),
    );
    return Array.map(edits, (op) => op.edit);
  }

  set(
    uri: Uri,
    edits: ReadonlyArray<
      | vscode.TextEdit
      | vscode.SnippetTextEdit
      | vscode.NotebookEdit
      | readonly [
          vscode.TextEdit | vscode.SnippetTextEdit | vscode.NotebookEdit,
          unknown,
        ]
    >,
  ): void {
    const remaining = Array.filter(
      this.operations,
      (op) => op.uri.toString() !== uri.toString(),
    );
    this.operations.length = 0;
    this.operations.push(...remaining);
    for (const item of edits) {
      const edit =
        'range' in item ? item : Array.isArray(item) ? item[0] : item;
      if ('newText' in edit) this.replace(uri, edit.range, edit.newText);
    }
  }

  createFile(): never {
    return unsupportedWorkspaceEdit('createFile');
  }

  deleteFile(): never {
    return unsupportedWorkspaceEdit('deleteFile');
  }

  renameFile(): never {
    return unsupportedWorkspaceEdit('renameFile');
  }
}

interface InternalTextDocument extends vscode.TextDocument {
  __setText: (text: string) => void;
}

const computeOffset = (text: string, position: Position): number => {
  // Walk the text counting characters until we hit `position.line` newlines.
  let line = 0;
  let char = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === position.line && char === position.character) return i;
    if (text[i] === '\n') {
      if (line === position.line) {
        // Position is past end-of-line; clamp.
        return i;
      }
      line++;
      char = 0;
    } else {
      char++;
    }
  }
  return text.length;
};

const createMockTextDocument = (
  uri: Uri,
  initial: string,
): InternalTextDocument => {
  let text = initial;
  const doc: InternalTextDocument = {
    uri,
    fileName: uri.fsPath,
    isUntitled: uri.scheme === 'untitled',
    languageId: 'plaintext',
    encoding: 'utf8',
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1,
    get lineCount(): number {
      return String.split(text, '\n').length;
    },
    getText: (range?: vscode.Range): string => {
      if (range === undefined) return text;
      return String.slice(
        computeOffset(text, range.start),
        computeOffset(text, range.end),
      )(text);
    },
    getWordRangeAtPosition: (
      position: Position,
      regex?: RegExp,
    ): Range | undefined => {
      const lines = String.split(text, '\n');
      const line = lines[position.line];
      if (line === undefined) return undefined;
      // Ensure global flag so we can iterate matches.
      const source = regex ?? /[a-zA-Z_$][a-zA-Z0-9_$]*/;
      const flags = String.includes('g')(source.flags)
        ? source.flags
        : `${source.flags}g`;
      const rx = new RegExp(source.source, flags);
      let match: RegExpExecArray | null;
      while ((match = rx.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
          return new Range(
            new Position(position.line, start),
            new Position(position.line, end),
          );
        }
        if (rx.lastIndex === match.index) rx.lastIndex++; // safety against zero-width loops
      }
      return undefined;
    },
    lineAt: (lineOrPosition: number | vscode.Position): vscode.TextLine => {
      const lineNumber =
        typeof lineOrPosition === 'number'
          ? lineOrPosition
          : lineOrPosition.line;
      const lines = String.split(text, '\n');
      const lineText = lines[lineNumber] ?? '';
      return {
        lineNumber,
        text: lineText,
        range: new Range(
          new Position(lineNumber, 0),
          new Position(lineNumber, lineText.length),
        ),
        rangeIncludingLineBreak: new Range(
          new Position(lineNumber, 0),
          lineNumber < lines.length - 1
            ? new Position(lineNumber + 1, 0)
            : new Position(lineNumber, lineText.length),
        ),
        firstNonWhitespaceCharacterIndex:
          lineText.length - String.trimStart(lineText).length,
        isEmptyOrWhitespace: String.trim(lineText) === '',
      };
    },
    offsetAt: (position) => computeOffset(text, position),
    positionAt: (offset) => {
      const lines = String.split(String.slice(0, offset)(text), '\n');
      return new Position(
        lines.length - 1,
        (lines[lines.length - 1] ?? '').length,
      );
    },
    validatePosition: (position) => doc.positionAt(doc.offsetAt(position)),
    validateRange: (range) =>
      new Range(
        doc.validatePosition(range.start),
        doc.validatePosition(range.end),
      ),
    save: () => Effect.runPromise(Effect.succeed(true)),
    __setText: (s: string): void => {
      text = s;
    },
  };
  return doc;
};

interface MockTab extends Pick<vscode.Tab, 'label' | 'isPinned'> {}

interface MockTabGroup extends vscode.TabGroup {
  tabs: Array<vscode.Tab>;
}

const createTabGroup = (
  tabs: ReadonlyArray<MockTab>,
  index: number,
): MockTabGroup => {
  const group: MockTabGroup = {
    tabs: [],
    isActive: index === 0,
    viewColumn: 1,
    get activeTab() {
      return this.tabs[0];
    },
  };
  group.tabs = Array.map(tabs, (tab) => ({
    ...tab,
    group,
    input: undefined,
    isActive: false,
    isDirty: false,
    isPreview: false,
  }));
  return group;
};

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

type CommandHandler = (...args: unknown[]) => unknown;

interface ExecutedCommand {
  id: string;
  args: unknown[];
}

interface ConfigurationChange {
  section: string;
  key: string;
  value: unknown;
  target: number;
}

interface ConfigurationEntry {
  defaultValue?: unknown;
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

interface StatusBarMessage {
  message: string;
  hideAfterTimeout: number | undefined;
}

// FileType — VSCode's bitmask: Unknown=0, File=1, Directory=2, SymbolicLink=64.
export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const;
export type FileType = (typeof FileType)[keyof typeof FileType];

export interface FileStat {
  type: FileType;
  ctime: number;
  mtime: number;
  size: number;
}

interface UpdateFoldersCall {
  start: number;
  deleteCount: number | null | undefined;
  adds: ReadonlyArray<{ uri: Uri; name?: string }>;
}

interface OpenDialogOptionsRecord {
  defaultUri?: Uri;
  openLabel?: string;
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  filters?: { readonly [name: string]: ReadonlyArray<string> };
  title?: string;
}

type QuickPickLifecycle = Pick<
  MockQuickPick,
  'show' | 'hide' | 'dispose' | 'shown' | 'disposed'
>;

interface MockState {
  registeredCommands: Map<string, CommandHandler>;
  executedCommands: ExecutedCommand[];
  contextKeys: Map<string, unknown>;
  configuration: Map<string, ConfigurationEntry>;
  configurationChanges: ConfigurationChange[];
  shownQuickPicks: unknown[];
  nextQuickPickResult: QuickPickItem | undefined;
  createdQuickPicks: QuickPickLifecycle[];
  shownInputBoxes: Array<{ options: unknown }>;
  nextInputBoxResult: string | undefined;
  shownMessages: Array<{
    level: 'info' | 'warn' | 'error';
    message: string;
    actions: readonly string[];
  }>;
  nextMessageResult: string | undefined;
  statusBarMessages: StatusBarMessage[];
  tabGroups: MockTabGroup[];
  closedTabs: MockTab[];
  documents: Map<string, InternalTextDocument>;
  appliedEdits: Array<Pick<vscode.WorkspaceEdit, 'entries'>>;
  activeTextEditor: vscode.TextEditor | undefined;
  textDocumentChangeListeners: Set<
    (event: vscode.TextDocumentChangeEvent) => unknown
  >;
  clipboard: string;
  workspaceFolders: WorkspaceFolder[] | undefined;
  fsEntries: Map<string, ReadonlyArray<[string, FileType]>>;
  fsStats: Map<string, FileStat>;
  fsContents: Map<string, Uint8Array>;
  updateFoldersCalls: UpdateFoldersCall[];
  nextUpdateFoldersResult: boolean;
  shownOpenDialogs: Array<{ options: OpenDialogOptionsRecord }>;
  nextOpenDialogResult: readonly Uri[] | undefined;
}

interface TextDocumentContentChangeEvent {
  readonly text: string;
}

export interface WorkspaceFolder {
  uri: Uri;
  name: string;
  index: number;
}

const state: MockState = {
  registeredCommands: new Map(),
  executedCommands: [],
  contextKeys: new Map(),
  configuration: new Map(),
  configurationChanges: [],
  shownQuickPicks: [],
  nextQuickPickResult: undefined,
  createdQuickPicks: [],
  shownInputBoxes: [],
  nextInputBoxResult: undefined,
  shownMessages: [],
  nextMessageResult: undefined,
  statusBarMessages: [],
  tabGroups: [],
  closedTabs: [],
  documents: new Map(),
  appliedEdits: [],
  activeTextEditor: undefined,
  textDocumentChangeListeners: new Set(),
  clipboard: '',
  workspaceFolders: undefined,
  fsEntries: new Map(),
  fsStats: new Map(),
  fsContents: new Map(),
  updateFoldersCalls: [],
  nextUpdateFoldersResult: true,
  shownOpenDialogs: [],
  nextOpenDialogResult: undefined,
};

const mergedConfigValue = (entry: ConfigurationEntry): unknown => {
  if (entry.workspaceFolderValue !== undefined)
    return entry.workspaceFolderValue;
  if (entry.workspaceValue !== undefined) return entry.workspaceValue;
  if (entry.globalValue !== undefined) return entry.globalValue;
  if (entry.defaultValue !== undefined) return entry.defaultValue;
  return undefined;
};

// ─────────────────────────────────────────────────────────────────────────────
// commands
// ─────────────────────────────────────────────────────────────────────────────

function executeCommand<T = unknown>(
  id: string,
  ...args: Array<unknown>
): HostEffect<T>;
function executeCommand(
  id: string,
  ...args: Array<unknown>
): HostEffect<unknown> {
  return Effect.gen(function* () {
    state.executedCommands.push({ id, args });
    if (id === 'setContext') {
      const [key, value] = args;
      if (typeof key === 'string') state.contextKeys.set(key, value);
      return undefined;
    }
    const handler = state.registeredCommands.get(id);
    if (handler === undefined) return undefined;
    return yield* Effect.tryPromise({
      try: () => Promise.resolve(handler(...args)),
      catch: (cause) => VSCodeHostError.make({ operation: id, cause }),
    });
  });
}

export const commands = {
  registerCommand: (id: string, handler: CommandHandler) => {
    state.registeredCommands.set(id, handler);
    return {
      dispose: () => {
        state.registeredCommands.delete(id);
      },
    };
  },
  executeCommand,
};

// ─────────────────────────────────────────────────────────────────────────────
// workspace
// ─────────────────────────────────────────────────────────────────────────────

interface ConfigurationInspection<T> {
  key: string;
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

interface WorkspaceConfiguration {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  has: (key: string) => boolean;
  update: (key: string, value: unknown, target?: number) => HostEffect<void>;
  inspect: <T>(key: string) => ConfigurationInspection<T> | undefined;
}

class MockFileNotFound extends Schema.TaggedError<MockFileNotFound, {}>()(
  'MockFileNotFound',
  {
    path: Schema.String,
    code: Schema.Literal('FileNotFound'),
  },
) {}

const notFound = (operation: string, uri: Uri) =>
  Effect.failSync(() =>
    VSCodeHostError.make({
      operation,
      cause: MockFileNotFound.make({ path: uri.fsPath, code: 'FileNotFound' }),
    }),
  );

export const workspace = {
  get workspaceFolders(): readonly WorkspaceFolder[] | undefined {
    return state.workspaceFolders;
  },
  getConfiguration: (section?: string): WorkspaceConfiguration => {
    const prefix = section === undefined ? '' : `${section}.`;
    function get<T>(key: string): T | undefined;
    function get<T>(key: string, defaultValue: T): T;
    function get(key: string, defaultValue?: unknown): unknown {
      const entry = state.configuration.get(`${prefix}${key}`);
      const merged = entry === undefined ? undefined : mergedConfigValue(entry);
      return merged === undefined ? defaultValue : merged;
    }
    function inspect<T>(key: string): ConfigurationInspection<T> | undefined;
    function inspect(
      key: string,
    ): ConfigurationInspection<unknown> | undefined {
      const fullKey = `${prefix}${key}`;
      const entry = state.configuration.get(fullKey);
      return entry === undefined ? undefined : { ...entry, key: fullKey };
    }
    return {
      get,
      has: (key: string): boolean => state.configuration.has(`${prefix}${key}`),
      update: (key: string, value: unknown, target?: number) =>
        Effect.sync(() => {
          const fullKey = `${prefix}${key}`;
          const entry: ConfigurationEntry =
            state.configuration.get(fullKey) ?? {};
          const tgt = target ?? ConfigurationTarget.Workspace;
          if (tgt === ConfigurationTarget.Global) entry.globalValue = value;
          else if (tgt === ConfigurationTarget.Workspace)
            entry.workspaceValue = value;
          else if (tgt === ConfigurationTarget.WorkspaceFolder)
            entry.workspaceFolderValue = value;
          state.configuration.set(fullKey, entry);
          state.configurationChanges.push({
            section: section ?? '',
            key,
            value,
            target: tgt,
          });
        }),
      inspect,
    };
  },
  onDidChangeConfiguration: (
    _listener: (e: vscode.ConfigurationChangeEvent) => unknown,
  ) => ({ dispose: () => {} }),
  onDidChangeWorkspaceFolders: (
    _listener: (e: vscode.WorkspaceFoldersChangeEvent) => unknown,
  ) => ({ dispose: () => {} }),
  onDidChangeTextDocument: (
    listener: (event: vscode.TextDocumentChangeEvent) => unknown,
  ) => {
    state.textDocumentChangeListeners.add(listener);
    return {
      dispose: () => {
        state.textDocumentChangeListeners.delete(listener);
      },
    };
  },
  openTextDocument: (target: Uri | string) =>
    Effect.sync(() => {
      const uri = typeof target === 'string' ? Uri.file(target) : target;
      const key = uri.toString();
      const existing = state.documents.get(key);
      if (existing !== undefined) return existing;
      // Documents that haven't been pre-seeded come back empty — tests should
      // seed via __state.openDocument() before invoking code that opens them.
      const doc = createMockTextDocument(uri, '');
      state.documents.set(key, doc);
      return doc;
    }),
  fs: {
    readDirectory: (uri: Uri) =>
      Effect.suspend(() => {
        const entries = state.fsEntries.get(uri.fsPath);
        return entries === undefined
          ? notFound('readDirectory', uri)
          : Effect.succeed(entries);
      }),
    stat: (uri: Uri) =>
      Effect.suspend(() => {
        const stat = state.fsStats.get(uri.fsPath);
        return stat === undefined
          ? notFound('stat', uri)
          : Effect.succeed(stat);
      }),
    readFile: (uri: Uri) =>
      Effect.suspend(() => {
        const content = state.fsContents.get(uri.fsPath);
        return content === undefined
          ? notFound('readFile', uri)
          : Effect.succeed(content);
      }),
    writeFile: (uri: Uri, content: Uint8Array) =>
      Effect.sync(() => {
        state.fsContents.set(uri.fsPath, content);
        state.fsStats.set(uri.fsPath, {
          type: FileType.File,
          ctime: 0,
          mtime: 0,
          size: content.byteLength,
        });
      }),
    createDirectory: (uri: Uri) =>
      Effect.sync(() => {
        // Recursive by VSCode's contract — idempotent if the directory already
        // exists. The mock just records a directory stat at the path; tests
        // that care about intermediate paths should seed them via setFsDirectory.
        state.fsStats.set(uri.fsPath, {
          type: FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: 0,
        });
        if (!state.fsEntries.has(uri.fsPath))
          state.fsEntries.set(uri.fsPath, []);
      }),
    rename: Effect.fnUntraced(function* (
      source: Uri,
      target: Uri,
      _options?: { readonly overwrite?: boolean },
    ) {
      const content = state.fsContents.get(source.fsPath);
      const stat = state.fsStats.get(source.fsPath);
      if (content === undefined && stat === undefined) {
        return yield* notFound('rename', source);
      }
      if (content !== undefined) state.fsContents.set(target.fsPath, content);
      if (stat !== undefined) state.fsStats.set(target.fsPath, stat);
      state.fsContents.delete(source.fsPath);
      state.fsStats.delete(source.fsPath);
    }),
  },
  applyEdit: (edit: Pick<vscode.WorkspaceEdit, 'entries'>) =>
    Effect.sync(() => {
      state.appliedEdits.push(edit);
      for (const [uri, edits] of edit.entries()) {
        const doc = state.documents.get(uri.toString());
        if (doc === undefined) continue;
        // Apply earlier-in-buffer edits last so they don't shift the offsets of
        // later-in-buffer edits. Sort descending by start position.
        const sorted = [...edits].sort((a, b) => {
          if (a.range.start.line !== b.range.start.line)
            return b.range.start.line - a.range.start.line;
          return b.range.start.character - a.range.start.character;
        });
        let text = doc.getText();
        for (const e of sorted) {
          const startOffset = computeOffset(text, e.range.start);
          const endOffset = computeOffset(text, e.range.end);
          text =
            String.slice(0, startOffset)(text) +
            e.newText +
            String.slice(endOffset)(text);
        }
        doc.__setText(text);
      }
      return true;
    }),
  // Fidelity gap: this records the splice request and returns the seeded
  // result, but does NOT mutate `state.workspaceFolders` to reflect the
  // applied splice. Tests doing "splice + read folders" should pre-seed the
  // post-splice state via `__state.setWorkspaceFolders(...)` rather than
  // relying on the mock to compute it. Real VSCode performs the mutation
  // synchronously; replicating its full semantics (multi-root auto-promotion,
  // workspace re-open) is out of scope — the mock exists to verify call shape.
  updateWorkspaceFolders: (
    start: number,
    deleteCount: number | null | undefined,
    ...adds: ReadonlyArray<{ readonly uri: vscode.Uri; readonly name?: string }>
  ): boolean => {
    state.updateFoldersCalls.push({
      start,
      deleteCount,
      adds: Array.map(adds, (a) =>
        a.name === undefined ? { uri: a.uri } : { uri: a.uri, name: a.name },
      ),
    });
    return state.nextUpdateFoldersResult;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// window
// ─────────────────────────────────────────────────────────────────────────────

interface InputBoxOptions {
  prompt?: string;
  value?: string;
  valueSelection?: [number, number];
  placeHolder?: string;
}

const tabGroupsApi = {
  get all(): readonly MockTabGroup[] {
    return state.tabGroups;
  },
  close: (tabsToClose: MockTab | ReadonlyArray<MockTab>) =>
    Effect.sync(() => {
      const list = 'label' in tabsToClose ? [tabsToClose] : tabsToClose;
      for (const tab of list)
        state.closedTabs.push({ label: tab.label, isPinned: tab.isPinned });
      for (const group of state.tabGroups) {
        group.tabs = Array.filter(
          group.tabs,
          (t) => !Array.some(list, (tab) => tab.label === t.label),
        );
      }
      return true;
    }),
};

export const window = {
  showQuickPick: (
    items: ReadonlyArray<vscode.QuickPickItem>,
    opts?: vscode.QuickPickOptions,
  ) =>
    Effect.sync(() => {
      state.shownQuickPicks.push({ items, opts });
      return state.nextQuickPickResult;
    }),
  showInputBox: (options?: InputBoxOptions) =>
    Effect.sync(() => {
      state.shownInputBoxes.push({ options });
      return state.nextInputBoxResult;
    }),
  showInformationMessage: (message: string, ...items: string[]) =>
    Effect.sync(() => {
      state.shownMessages.push({
        level: 'info',
        message,
        actions: [...items],
      });
      return items.length > 0 ? state.nextMessageResult : undefined;
    }),
  showWarningMessage: (message: string, ...items: string[]) =>
    Effect.sync(() => {
      state.shownMessages.push({
        level: 'warn',
        message,
        actions: [...items],
      });
      return items.length > 0 ? state.nextMessageResult : undefined;
    }),
  showErrorMessage: (message: string, ...items: string[]) =>
    Effect.sync(() => {
      state.shownMessages.push({
        level: 'error',
        message,
        actions: [...items],
      });
      return items.length > 0 ? state.nextMessageResult : undefined;
    }),
  setStatusBarMessage: (message: string, hideAfterTimeout?: number) => {
    state.statusBarMessages.push({ message, hideAfterTimeout });
    return { dispose: (): void => {} };
  },
  showOpenDialog: (options?: OpenDialogOptionsRecord) =>
    Effect.sync(() => {
      // Snapshot the options object so later mutation by the caller doesn't
      // retroactively alter recorded test state.
      const recorded: OpenDialogOptionsRecord = {};
      if (options?.defaultUri !== undefined)
        recorded.defaultUri = options.defaultUri;
      if (options?.openLabel !== undefined)
        recorded.openLabel = options.openLabel;
      if (options?.canSelectFiles !== undefined)
        recorded.canSelectFiles = options.canSelectFiles;
      if (options?.canSelectFolders !== undefined)
        recorded.canSelectFolders = options.canSelectFolders;
      if (options?.canSelectMany !== undefined)
        recorded.canSelectMany = options.canSelectMany;
      if (options?.filters !== undefined) recorded.filters = options.filters;
      if (options?.title !== undefined) recorded.title = options.title;
      state.shownOpenDialogs.push({ options: recorded });
      return state.nextOpenDialogResult;
    }),
  get activeTextEditor(): vscode.TextEditor | undefined {
    return state.activeTextEditor;
  },
  tabGroups: tabGroupsApi,
  createQuickPick: <
    T extends QuickPickItem = QuickPickItem,
  >(): MockQuickPick<T> => {
    const qp = new MockQuickPick<T>();
    state.createdQuickPicks.push(qp);
    return qp;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// disposables / events
// ─────────────────────────────────────────────────────────────────────────────

type EventListener<T> = (value: T) => unknown;

export class EventEmitter<T> {
  private readonly listeners = new Set<EventListener<T>>();

  readonly event = (listener: EventListener<T>) => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export class Disposable {
  private readonly callOnDispose: () => void;

  constructor(callOnDispose: () => void) {
    this.callOnDispose = callOnDispose;
  }

  dispose(): void {
    this.callOnDispose();
  }

  static from(...disposables: Array<{ dispose: () => void }>): Disposable {
    return new Disposable(() => {
      for (const d of disposables) {
        d.dispose();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// quick pick (stateful — the createQuickPick API, not the showQuickPick promise)
// ─────────────────────────────────────────────────────────────────────────────

export interface QuickPickItem {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
}

/**
 * @description Stateful mock of `vscode.QuickPick<T>`. Properties match the
 * real API shape; lifecycle observable via `shown` / `disposed`. Test code
 * simulates user interaction via the `__fire*` escape hatches.
 */
export class MockQuickPick<T extends QuickPickItem = QuickPickItem> {
  title = '';
  matchOnDescription = false;
  matchOnDetail = false;
  items: ReadonlyArray<T> = [];
  activeItems: ReadonlyArray<T> = [];
  selectedItems: ReadonlyArray<T> = [];
  value = '';
  placeholder?: string;
  busy = false;
  enabled = true;
  canSelectMany = false;

  shown = false;
  disposed = false;

  private readonly changeValueListeners = new Set<(value: string) => unknown>();
  private readonly acceptListeners = new Set<() => unknown>();
  private readonly hideListeners = new Set<() => unknown>();
  private readonly changeActiveListeners = new Set<
    (items: ReadonlyArray<T>) => unknown
  >();
  private readonly changeSelectionListeners = new Set<
    (items: ReadonlyArray<T>) => unknown
  >();

  show(): void {
    this.shown = true;
  }

  hide(): void {
    if (this.shown) {
      this.shown = false;
      for (const l of this.hideListeners) l();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.shown = false;
    this.changeValueListeners.clear();
    this.acceptListeners.clear();
    this.hideListeners.clear();
    this.changeActiveListeners.clear();
    this.changeSelectionListeners.clear();
  }

  onDidChangeValue(handler: (value: string) => unknown): Disposable {
    this.changeValueListeners.add(handler);
    return new Disposable(() => {
      this.changeValueListeners.delete(handler);
    });
  }

  onDidAccept(handler: () => unknown): Disposable {
    this.acceptListeners.add(handler);
    return new Disposable(() => {
      this.acceptListeners.delete(handler);
    });
  }

  onDidHide(handler: () => unknown): Disposable {
    this.hideListeners.add(handler);
    return new Disposable(() => {
      this.hideListeners.delete(handler);
    });
  }

  onDidChangeActive(handler: (items: ReadonlyArray<T>) => unknown): Disposable {
    this.changeActiveListeners.add(handler);
    return new Disposable(() => {
      this.changeActiveListeners.delete(handler);
    });
  }

  onDidChangeSelection(
    handler: (items: ReadonlyArray<T>) => unknown,
  ): Disposable {
    this.changeSelectionListeners.add(handler);
    return new Disposable(() => {
      this.changeSelectionListeners.delete(handler);
    });
  }

  // Test escape hatches — simulate user interaction. Names mirror
  // `vscode.QuickPick`'s event names so test reads naturally:
  //   `qp.__fireChangeValue('foo')` — user typed 'foo'
  //   `qp.__fireAccept()`           — user pressed Enter on activeItems[0]
  //   `qp.__fireHide()`             — user dismissed (Escape, click-away)

  __fireChangeValue(value: string): void {
    this.value = value;
    for (const l of this.changeValueListeners) l(value);
  }

  __fireAccept(): void {
    for (const l of this.acceptListeners) l();
  }

  __fireHide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const l of this.hideListeners) l();
  }
}

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// env — process/host-level surfaces
// ─────────────────────────────────────────────────────────────────────────────

export const env = {
  clipboard: {
    readText: () => Effect.sync(() => state.clipboard),
    writeText: (text: string) =>
      Effect.sync(() => {
        state.clipboard = text;
      }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// __state — observable + settable knobs for tests
// ─────────────────────────────────────────────────────────────────────────────

// The host still requires these methods on a TextEditor.
const legacyEditorVisibility = {
  show: () => {},
  hide: () => {},
};

export const __state = {
  reset: (): void => {
    state.registeredCommands.clear();
    state.executedCommands = [];
    state.contextKeys.clear();
    state.configuration.clear();
    state.configurationChanges = [];
    state.shownQuickPicks = [];
    state.nextQuickPickResult = undefined;
    state.createdQuickPicks = [];
    state.shownInputBoxes = [];
    state.nextInputBoxResult = undefined;
    state.shownMessages = [];
    state.nextMessageResult = undefined;
    state.statusBarMessages = [];
    state.tabGroups = [];
    state.closedTabs = [];
    state.documents.clear();
    state.appliedEdits = [];
    state.activeTextEditor = undefined;
    state.textDocumentChangeListeners.clear();
    state.clipboard = '';
    state.workspaceFolders = undefined;
    state.fsEntries.clear();
    state.fsStats.clear();
    state.fsContents.clear();
    state.updateFoldersCalls = [];
    state.nextUpdateFoldersResult = true;
    state.shownOpenDialogs = [];
    state.nextOpenDialogResult = undefined;
  },

  // Filesystem (mock)
  setFsDirectory: (
    path: string,
    entries: ReadonlyArray<[string, FileType]>,
  ): void => {
    state.fsEntries.set(path, entries);
    state.fsStats.set(path, {
      type: FileType.Directory,
      ctime: 0,
      mtime: 0,
      size: 0,
    });
  },
  setFsStat: (path: string, stat: FileStat): void => {
    state.fsStats.set(path, stat);
  },
  setFsContent: (path: string, content: Uint8Array): void => {
    state.fsContents.set(path, content);
    state.fsStats.set(path, {
      type: FileType.File,
      ctime: 0,
      mtime: 0,
      size: content.byteLength,
    });
  },
  getFsContent: (path: string): Uint8Array | undefined =>
    state.fsContents.get(path),

  // Clipboard
  getClipboard: (): string => state.clipboard,
  setClipboard: (text: string): void => {
    state.clipboard = text;
  },

  // Workspace folders
  setWorkspaceFolders: (
    folders: ReadonlyArray<{ uri: Uri; name?: string }>,
  ): void => {
    state.workspaceFolders = Array.map(folders, (f, index) => ({
      uri: f.uri,
      name: f.name ?? String.split(f.uri.fsPath, '/').pop() ?? '',
      index,
    }));
  },

  // Commands
  getRegisteredCommands: (): string[] =>
    Array.fromIterable(state.registeredCommands.keys()),
  getExecutedCommands: (): ReadonlyArray<ExecutedCommand> => [
    ...state.executedCommands,
  ],

  // Context keys
  getContextKeys: (): Readonly<Record<string, unknown>> =>
    Record.fromEntries(state.contextKeys),
  deleteContextKey: (key: string): void => {
    state.contextKeys.delete(key);
  },
  setContextKey: (key: string, value: unknown): void => {
    state.contextKeys.set(key, value);
  },

  // Configuration — setConfiguration writes to globalValue (the natural target
  // for "this is the user's setting"). For per-target seeding, use
  // setConfigurationDetail.
  getConfiguration: (): Readonly<Record<string, unknown>> => {
    const out: Record<string, unknown> = {};
    for (const [k, entry] of state.configuration) {
      const merged = mergedConfigValue(entry);
      if (merged !== undefined) out[k] = merged;
    }
    return out;
  },
  getConfigurationChanges: (): ReadonlyArray<ConfigurationChange> => [
    ...state.configurationChanges,
  ],
  setConfiguration: (entries: Readonly<Record<string, unknown>>): void => {
    for (const [k, v] of Record.toEntries(entries)) {
      const entry: ConfigurationEntry = state.configuration.get(k) ?? {};
      entry.globalValue = v;
      state.configuration.set(k, entry);
    }
  },
  setConfigurationDetail: (key: string, detail: ConfigurationEntry): void => {
    state.configuration.set(key, {
      ...state.configuration.get(key),
      ...detail,
    });
  },
  inspectConfiguration: (key: string): ConfigurationEntry | undefined => {
    const entry = state.configuration.get(key);
    if (entry === undefined) return undefined;
    return { ...entry };
  },

  // Quick picks (showQuickPick — Promise-returning API)
  getShownQuickPicks: (): ReadonlyArray<unknown> => [...state.shownQuickPicks],
  setNextQuickPickResult: (value: QuickPickItem | undefined): void => {
    state.nextQuickPickResult = value;
  },

  // Quick picks (createQuickPick — stateful API)
  getCreatedQuickPicks: (): ReadonlyArray<QuickPickLifecycle> => [
    ...state.createdQuickPicks,
  ],
  getLastCreatedQuickPick: (): QuickPickLifecycle | undefined =>
    state.createdQuickPicks[state.createdQuickPicks.length - 1],

  // Input box
  getShownInputBoxes: (): ReadonlyArray<{ options: unknown }> => [
    ...state.shownInputBoxes,
  ],
  setNextInputBoxResult: (value: string | undefined): void => {
    state.nextInputBoxResult = value;
  },

  // Messages
  getShownMessages: (): ReadonlyArray<{
    level: 'info' | 'warn' | 'error';
    message: string;
    actions: readonly string[];
  }> => [...state.shownMessages],
  setNextMessageResult: (value: string | undefined): void => {
    state.nextMessageResult = value;
  },

  // Status bar
  getStatusBarMessages: (): ReadonlyArray<StatusBarMessage> => [
    ...state.statusBarMessages,
  ],

  // Tab groups
  getTabGroups: (): ReadonlyArray<MockTabGroup> => state.tabGroups,
  getClosedTabs: (): ReadonlyArray<MockTab> => [...state.closedTabs],
  setTabGroups: (
    groups: ReadonlyArray<{ tabs: ReadonlyArray<MockTab> }>,
  ): void => {
    state.tabGroups = Array.map(groups, (group, index) =>
      createTabGroup(group.tabs, index),
    );
  },
  setTabs: (tabs: ReadonlyArray<MockTab>): void => {
    state.tabGroups = [createTabGroup(tabs, 0)];
  },

  // Documents + editor
  getDocuments: (): ReadonlyArray<vscode.TextDocument> => [
    ...state.documents.values(),
  ],
  getAppliedEdits: (): ReadonlyArray<Pick<vscode.WorkspaceEdit, 'entries'>> => [
    ...state.appliedEdits,
  ],
  openDocument: (uri: Uri | string, content: string): vscode.TextDocument => {
    const u = typeof uri === 'string' ? Uri.parse(uri) : uri;
    const doc = createMockTextDocument(u, content);
    state.documents.set(u.toString(), doc);
    return doc;
  },
  setActiveTextEditor: (editor: vscode.TextEditor | undefined): void => {
    state.activeTextEditor = editor;
  },
  setActiveCursor: (
    uri: Uri | string,
    content: string,
    cursor: Position | { line: number; character: number },
  ): vscode.TextDocument => {
    const u = typeof uri === 'string' ? Uri.parse(uri) : uri;
    const doc = createMockTextDocument(u, content);
    state.documents.set(u.toString(), doc);
    const pos = new Position(cursor.line, cursor.character);
    const selection = new Selection(pos, pos);
    state.activeTextEditor = {
      document: doc,
      selection,
      selections: [selection],
      visibleRanges: [],
      options: {},
      viewColumn: 1,
      edit: () => Effect.runPromise(Effect.succeed(false)),
      insertSnippet: () => Effect.runPromise(Effect.succeed(false)),
      setDecorations: () => {},
      revealRange: () => {},
      ...legacyEditorVisibility,
    };
    return doc;
  },
  fireTextDocumentChange: (
    document: vscode.TextDocument,
    contentChanges: readonly TextDocumentContentChangeEvent[],
  ): void => {
    const event: vscode.TextDocumentChangeEvent = {
      document,
      reason: undefined,
      contentChanges: Array.map(contentChanges, ({ text }) => ({
        text,
        range: new Range(0, 0, 0, 0),
        rangeOffset: 0,
        rangeLength: 0,
      })),
    };
    for (const listener of state.textDocumentChangeListeners) {
      listener(event);
    }
  },

  // Workspace folder splice — recorded calls + seedable result
  getUpdateFolderCalls: (): ReadonlyArray<UpdateFoldersCall> => [
    ...state.updateFoldersCalls,
  ],
  setNextUpdateFoldersResult: (result: boolean): void => {
    state.nextUpdateFoldersResult = result;
  },

  // Open dialog — recorded calls + seedable result
  getOpenDialogCalls: (): ReadonlyArray<{
    options: OpenDialogOptionsRecord;
  }> => [...state.shownOpenDialogs],
  setNextOpenDialogResult: (result: readonly Uri[] | undefined): void => {
    state.nextOpenDialogResult = result;
  },
};
