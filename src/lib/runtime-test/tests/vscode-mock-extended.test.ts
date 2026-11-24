import { beforeEach, describe, expect, test } from 'bun:test';
import { Effect, Array, Option } from 'effect';
import { installVSCodeMock } from '../install-mock.ts';
import { testEffect } from '../test-effect.ts';
import * as mod from '../vscode-mock.ts';

const vscode = installVSCodeMock();

beforeEach(() => {
  vscode.reset();
});

describe('Position / Range / Selection / Uri value types', () => {
  test('Position equality and ordering', () => {
    const a = new mod.Position(2, 5);
    const b = new mod.Position(2, 5);
    const c = new mod.Position(3, 0);
    expect(a.isEqual(b)).toBe(true);
    expect(a.isBefore(c)).toBe(true);
    expect(c.isBefore(a)).toBe(false);
    expect(a.translate(1, 2).line).toBe(3);
    expect(a.translate(1, 2).character).toBe(7);
  });

  test('Range constructor accepts both Position pairs and (line,char,line,char)', () => {
    const r1 = new mod.Range(new mod.Position(0, 0), new mod.Position(1, 5));
    const r2 = new mod.Range(0, 0, 1, 5);
    expect(r1.start.isEqual(r2.start)).toBe(true);
    expect(r1.end.isEqual(r2.end)).toBe(true);
  });

  test('Range.contains checks point or sub-range', () => {
    const r = new mod.Range(0, 0, 5, 0);
    expect(r.contains(new mod.Position(2, 3))).toBe(true);
    expect(r.contains(new mod.Position(6, 0))).toBe(false);
    expect(r.contains(new mod.Range(1, 0, 4, 0))).toBe(true);
    expect(r.contains(new mod.Range(1, 0, 6, 0))).toBe(false);
  });

  test('Selection wraps active+anchor with start≤end normalization', () => {
    // Backward selection: anchor after active. Selection.start must be the
    // earlier position regardless.
    const anchor = new mod.Position(3, 5);
    const active = new mod.Position(1, 0);
    const sel = new mod.Selection(anchor, active);
    expect(sel.active.isEqual(active)).toBe(true);
    expect(sel.anchor.isEqual(anchor)).toBe(true);
    expect(sel.start.isEqual(active)).toBe(true);
    expect(sel.end.isEqual(anchor)).toBe(true);
  });

  test('Uri.parse + toString roundtrip for file: scheme', () => {
    const u = mod.Uri.parse('file:///Users/x/y.ts');
    expect(u.scheme).toBe('file');
    expect(u.path).toBe('/Users/x/y.ts');
    expect(u.fsPath).toBe('/Users/x/y.ts');
    expect(u.toString()).toBe('file:///Users/x/y.ts');
  });

  test('Uri.file produces file: scheme', () => {
    const u = mod.Uri.file('/Users/x/y.ts');
    expect(u.scheme).toBe('file');
    expect(u.fsPath).toBe('/Users/x/y.ts');
  });

  test('Uri.parse handles non-file schemes', () => {
    const u = mod.Uri.parse('untitled:Untitled-1');
    expect(u.scheme).toBe('untitled');
    expect(u.path).toBe('Untitled-1');
  });
});

describe('WorkspaceConfiguration.inspect / per-target update', () => {
  testEffect(
    'update writes to target-specific slot',
    Effect.gen(function* () {
      const cfg = mod.workspace.getConfiguration('explorer');
      yield* cfg.update('confirmDelete', false, mod.ConfigurationTarget.Global);
      const ins = cfg.inspect<boolean>('confirmDelete');
      expect(ins?.globalValue).toBe(false);
      expect(ins?.workspaceValue).toBeUndefined();
      expect(ins?.workspaceFolderValue).toBeUndefined();
    }),
  );

  test('inspect returns undefined for unknown keys', () => {
    expect(
      mod.workspace.getConfiguration('explorer').inspect('confirmDelete'),
    ).toBeUndefined();
  });

  test('get reads workspaceFolder > workspace > global > default precedence', () => {
    vscode.state.setConfigurationDetail('explorer.confirmDelete', {
      defaultValue: true,
      globalValue: true,
      workspaceValue: false,
    });
    const cfg = mod.workspace.getConfiguration('explorer');
    // workspaceValue overrides globalValue and defaultValue
    expect(cfg.get<boolean>('confirmDelete')).toBe(false);
  });

  testEffect(
    'save → mutate → restore flow (explorer-delete pattern) works',
    Effect.gen(function* () {
      vscode.state.setConfigurationDetail('explorer.confirmDelete', {
        globalValue: true,
      });
      const cfg = mod.workspace.getConfiguration('explorer');
      const original = cfg.inspect<boolean>('confirmDelete')?.globalValue;
      expect(original).toBe(true);
      yield* cfg.update('confirmDelete', false, mod.ConfigurationTarget.Global);
      expect(cfg.inspect<boolean>('confirmDelete')?.globalValue).toBe(false);
      yield* cfg.update(
        'confirmDelete',
        original,
        mod.ConfigurationTarget.Global,
      );
      expect(cfg.inspect<boolean>('confirmDelete')?.globalValue).toBe(true);
    }),
  );
});

describe('window.setStatusBarMessage', () => {
  test('records messages with timeout', () => {
    mod.window.setStatusBarMessage('hello', 1500);
    mod.window.setStatusBarMessage('world');
    const msgs = vscode.state.getStatusBarMessages();
    expect(msgs).toEqual([
      { message: 'hello', hideAfterTimeout: 1500 },
      { message: 'world', hideAfterTimeout: undefined },
    ]);
  });

  test('returns Disposable shape', () => {
    const d = mod.window.setStatusBarMessage('x', 100);
    expect(typeof d.dispose).toBe('function');
  });
});

describe('window.showInputBox', () => {
  testEffect(
    'returns nextInputBoxResult and records call',
    Effect.gen(function* () {
      vscode.state.setNextInputBoxResult('newName');
      const result = yield* mod.window.showInputBox({ prompt: 'Rename to…' });
      expect(result).toBe('newName');
      const recorded = vscode.state.getShownInputBoxes();
      expect(recorded.length).toBe(1);
    }),
  );

  testEffect(
    'returns undefined when no next result is set',
    Effect.gen(function* () {
      const result = yield* mod.window.showInputBox();
      expect(result).toBeUndefined();
    }),
  );
});

describe('window.tabGroups', () => {
  test('all reflects state.setTabs', () => {
    vscode.state.setTabs([
      { label: 'a.ts', isPinned: false },
      { label: 'b.ts', isPinned: true },
    ]);
    const groups = mod.window.tabGroups.all;
    expect(groups.length).toBe(1);
    expect(groups[0]?.tabs.length).toBe(2);
  });

  testEffect(
    'close removes tabs and records them',
    Effect.gen(function* () {
      const a = { label: 'a.ts', isPinned: false };
      const b = { label: 'b.ts', isPinned: true };
      vscode.state.setTabs([a, b]);
      yield* mod.window.tabGroups.close([a]);
      expect(mod.window.tabGroups.all[0]?.tabs).toMatchObject([b]);
      expect(vscode.state.getClosedTabs()).toEqual([a]);
    }),
  );

  testEffect(
    'closeUnpinnedTabs flow: filter → close → state reflects only pinned',
    Effect.gen(function* () {
      const t1 = { label: 'a.ts', isPinned: false };
      const t2 = { label: 'b.ts', isPinned: true };
      const t3 = { label: 'c.ts', isPinned: false };
      vscode.state.setTabGroups([{ tabs: [t1, t2] }, { tabs: [t3] }]);
      const unpinned = Array.flatMap(mod.window.tabGroups.all, (g) =>
        Array.filter(g.tabs, (t) => !t.isPinned),
      );
      expect(unpinned.length).toBe(2);
      yield* mod.window.tabGroups.close(unpinned);
      const remaining = Array.flatMap(mod.window.tabGroups.all, (g) => g.tabs);
      expect(remaining).toMatchObject([t2]);
    }),
  );
});

describe('TextDocument', () => {
  testEffect(
    'openDocument registers a doc; openTextDocument finds it',
    Effect.gen(function* () {
      vscode.state.openDocument('file:///x.ts', 'hello world');
      const doc = yield* mod.workspace.openTextDocument(
        mod.Uri.parse('file:///x.ts'),
      );
      expect(doc.getText()).toBe('hello world');
    }),
  );

  test('getText with range slices correctly across lines', () => {
    const doc = vscode.state.openDocument(
      'file:///x.ts',
      'line0\nline1\nline2',
    );
    const range = new mod.Range(new mod.Position(0, 2), new mod.Position(2, 3));
    expect(doc.getText(range)).toBe('ne0\nline1\nlin');
  });

  test('getWordRangeAtPosition finds identifier under cursor', () => {
    const doc = vscode.state.openDocument('file:///x.ts', 'const myVar = 1');
    const r = doc.getWordRangeAtPosition(new mod.Position(0, 9));
    expect(r).toBeDefined();
    expect(r?.start.character).toBe(6);
    expect(r?.end.character).toBe(11);
    expect(doc.getText(r)).toBe('myVar');
  });

  test('getWordRangeAtPosition returns undefined on whitespace', () => {
    // "abc   def" — position 4 sits in the middle of the three-space gap, so
    // it cannot be inside either identifier regardless of inclusive-end
    // semantics.
    const doc = vscode.state.openDocument('file:///x.ts', 'abc   def');
    expect(doc.getWordRangeAtPosition(new mod.Position(0, 4))).toBeUndefined();
  });

  test('getWordRangeAtPosition boundary semantics match VSCode (inclusive end)', () => {
    // VSCode's TextModel.getWordAtPosition treats column == end-of-word as
    // INSIDE the word (so cursor-just-past-last-char still matches). The
    // mock matches: `start <= pos <= end` where `end` is the exclusive-end
    // index of the regex match, but with `<=` the position equal to `end`
    // still resolves to the word.
    const doc = vscode.state.openDocument('file:///x.ts', 'foo bar');
    // Position 0 (start of foo) → matches 'foo'.
    expect(
      doc.getWordRangeAtPosition(new mod.Position(0, 0))?.end.character,
    ).toBe(3);
    // Position 3 (end of foo, before space) → still matches 'foo'.
    expect(
      doc.getWordRangeAtPosition(new mod.Position(0, 3))?.end.character,
    ).toBe(3);
    // Position 4 (start of bar, after space) → matches 'bar'.
    expect(
      doc.getWordRangeAtPosition(new mod.Position(0, 4))?.start.character,
    ).toBe(4);
    // Position 7 (end of bar, end-of-line) → still matches 'bar'.
    expect(
      doc.getWordRangeAtPosition(new mod.Position(0, 7))?.end.character,
    ).toBe(7);
  });

  test('lineAt returns text and full-line range', () => {
    const doc = vscode.state.openDocument(
      'file:///x.ts',
      'first\nsecond\nthird',
    );
    const line = doc.lineAt(1);
    expect(line.text).toBe('second');
    expect(line.range.end.character).toBe(6);
  });

  test('lineCount counts lines', () => {
    const doc = vscode.state.openDocument('file:///x.ts', 'a\nb\nc');
    expect(doc.lineCount).toBe(3);
  });
});

describe('window.activeTextEditor', () => {
  test('setActiveCursor wires editor.document and editor.selection.active', () => {
    vscode.state.setActiveCursor('file:///x.ts', 'const foo = 1', {
      line: 0,
      character: 8,
    });
    const editor = mod.window.activeTextEditor;
    expect(editor?.selection.active.character).toBe(8);
    expect(editor?.document.getText()).toBe('const foo = 1');
  });

  test('reset clears active editor', () => {
    vscode.state.setActiveCursor('file:///x.ts', 'x', {
      line: 0,
      character: 0,
    });
    expect(mod.window.activeTextEditor).toBeDefined();
    vscode.reset();
    expect(mod.window.activeTextEditor).toBeUndefined();
  });
});

describe('WorkspaceEdit + workspace.applyEdit', () => {
  test('replace + entries groups edits per uri', () => {
    const u = mod.Uri.file('/x.ts');
    const v = mod.Uri.file('/y.ts');
    const edit = new mod.WorkspaceEdit();
    edit.replace(u, new mod.Range(0, 0, 0, 5), 'aaaaa');
    edit.replace(v, new mod.Range(0, 0, 0, 3), 'bbb');
    edit.replace(u, new mod.Range(1, 0, 1, 4), 'cccc');
    const entries = edit.entries();
    expect(entries.length).toBe(2);
    const uEntry = Option.getOrUndefined(
      Array.findFirst(entries, ([uri]) => uri.toString() === u.toString()),
    );
    expect(uEntry?.[1].length).toBe(2);
  });

  testEffect(
    'applyEdit rewrites doc text using sorted-descending offsets',
    Effect.gen(function* () {
      const u = mod.Uri.file('/x.ts');
      vscode.state.openDocument(u, 'foo bar baz');
      const edit = new mod.WorkspaceEdit();
      // Two non-overlapping replaces — applied in sorted-descending order so
      // the earlier one's offset isn't shifted by the later one.
      edit.replace(u, new mod.Range(0, 0, 0, 3), 'xxx'); // foo → xxx
      edit.replace(u, new mod.Range(0, 8, 0, 11), 'zzz'); // baz → zzz
      yield* mod.workspace.applyEdit(edit);
      const doc = yield* mod.workspace.openTextDocument(u);
      expect(doc.getText()).toBe('xxx bar zzz');
    }),
  );

  testEffect(
    'applyEdit handles cross-line full-document replace',
    Effect.gen(function* () {
      const u = mod.Uri.file('/x.ts');
      const doc = vscode.state.openDocument(u, 'first\nsecond\nthird');
      const edit = new mod.WorkspaceEdit();
      const lastLine = doc.lineCount - 1;
      const lastCol = doc.lineAt(lastLine).range.end.character;
      edit.replace(
        u,
        new mod.Range(
          new mod.Position(0, 0),
          new mod.Position(lastLine, lastCol),
        ),
        'a\nb\nc',
      );
      yield* mod.workspace.applyEdit(edit);
      const updated = yield* mod.workspace.openTextDocument(u);
      expect(updated.getText()).toBe('a\nb\nc');
    }),
  );

  testEffect(
    'applyEdit records the edit on __state',
    Effect.gen(function* () {
      const edit = new mod.WorkspaceEdit();
      edit.replace(mod.Uri.file('/x.ts'), new mod.Range(0, 0, 0, 1), 'X');
      yield* mod.workspace.applyEdit(edit);
      expect(vscode.state.getAppliedEdits().length).toBe(1);
    }),
  );

  testEffect(
    'applyEdit on missing doc no-ops cleanly',
    Effect.gen(function* () {
      const edit = new mod.WorkspaceEdit();
      edit.replace(mod.Uri.file('/missing.ts'), new mod.Range(0, 0, 0, 1), 'X');
      const ok = yield* mod.workspace.applyEdit(edit);
      expect(ok).toBe(true);
    }),
  );
});

describe('reset() clears all new state', () => {
  testEffect(
    'reset clears statusBar, inputBoxes, tabs, docs, edits, activeEditor',
    Effect.gen(function* () {
      mod.window.setStatusBarMessage('m');
      vscode.state.setNextInputBoxResult('x');
      yield* mod.window.showInputBox();
      vscode.state.setTabs([{ label: 'a', isPinned: false }]);
      vscode.state.openDocument('file:///x.ts', 'x');
      vscode.state.setActiveCursor('file:///y.ts', 'y', {
        line: 0,
        character: 0,
      });
      const edit = new mod.WorkspaceEdit();
      edit.replace(mod.Uri.file('/x.ts'), new mod.Range(0, 0, 0, 1), 'X');
      yield* mod.workspace.applyEdit(edit);

      vscode.reset();

      expect(vscode.state.getStatusBarMessages()).toEqual([]);
      expect(vscode.state.getShownInputBoxes()).toEqual([]);
      expect(vscode.state.getTabGroups()).toEqual([]);
      expect(vscode.state.getDocuments()).toEqual([]);
      expect(vscode.state.getAppliedEdits()).toEqual([]);
      expect(mod.window.activeTextEditor).toBeUndefined();
    }),
  );
});
