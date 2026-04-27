import { beforeEach, describe, expect, test } from 'bun:test'
import { installVSCodeMock } from '../install-mock.ts'

const vscode = installVSCodeMock()

const loadMock = async (): Promise<typeof import('../vscode-mock.ts')> =>
  (await import('vscode')) as unknown as typeof import('../vscode-mock.ts')

beforeEach(() => {
  vscode.reset()
})

describe('Position / Range / Selection / Uri value types', () => {
  test('Position equality and ordering', async () => {
    const mod = await loadMock()
    const a = new mod.Position(2, 5)
    const b = new mod.Position(2, 5)
    const c = new mod.Position(3, 0)
    expect(a.isEqual(b)).toBe(true)
    expect(a.isBefore(c)).toBe(true)
    expect(c.isBefore(a)).toBe(false)
    expect(a.translate(1, 2).line).toBe(3)
    expect(a.translate(1, 2).character).toBe(7)
  })

  test('Range constructor accepts both Position pairs and (line,char,line,char)', async () => {
    const mod = await loadMock()
    const r1 = new mod.Range(new mod.Position(0, 0), new mod.Position(1, 5))
    const r2 = new mod.Range(0, 0, 1, 5)
    expect(r1.start.isEqual(r2.start)).toBe(true)
    expect(r1.end.isEqual(r2.end)).toBe(true)
  })

  test('Range.contains checks point or sub-range', async () => {
    const mod = await loadMock()
    const r = new mod.Range(0, 0, 5, 0)
    expect(r.contains(new mod.Position(2, 3))).toBe(true)
    expect(r.contains(new mod.Position(6, 0))).toBe(false)
    expect(r.contains(new mod.Range(1, 0, 4, 0))).toBe(true)
    expect(r.contains(new mod.Range(1, 0, 6, 0))).toBe(false)
  })

  test('Selection wraps active+anchor with start≤end normalization', async () => {
    const mod = await loadMock()
    // Backward selection: anchor after active. Selection.start must be the
    // earlier position regardless.
    const anchor = new mod.Position(3, 5)
    const active = new mod.Position(1, 0)
    const sel = new mod.Selection(anchor, active)
    expect(sel.active.isEqual(active)).toBe(true)
    expect(sel.anchor.isEqual(anchor)).toBe(true)
    expect(sel.start.isEqual(active)).toBe(true)
    expect(sel.end.isEqual(anchor)).toBe(true)
  })

  test('Uri.parse + toString roundtrip for file: scheme', async () => {
    const mod = await loadMock()
    const u = mod.Uri.parse('file:///Users/x/y.ts')
    expect(u.scheme).toBe('file')
    expect(u.path).toBe('/Users/x/y.ts')
    expect(u.fsPath).toBe('/Users/x/y.ts')
    expect(u.toString()).toBe('file:///Users/x/y.ts')
  })

  test('Uri.file produces file: scheme', async () => {
    const mod = await loadMock()
    const u = mod.Uri.file('/Users/x/y.ts')
    expect(u.scheme).toBe('file')
    expect(u.fsPath).toBe('/Users/x/y.ts')
  })

  test('Uri.parse handles non-file schemes', async () => {
    const mod = await loadMock()
    const u = mod.Uri.parse('untitled:Untitled-1')
    expect(u.scheme).toBe('untitled')
    expect(u.path).toBe('Untitled-1')
  })
})

describe('WorkspaceConfiguration.inspect / per-target update', () => {
  test('update writes to target-specific slot', async () => {
    const mod = await loadMock()
    const cfg = mod.workspace.getConfiguration('explorer')
    await cfg.update('confirmDelete', false, mod.ConfigurationTarget.Global)
    const ins = cfg.inspect<boolean>('confirmDelete')
    expect(ins?.globalValue).toBe(false)
    expect(ins?.workspaceValue).toBeUndefined()
    expect(ins?.workspaceFolderValue).toBeUndefined()
  })

  test('inspect returns undefined for unknown keys', async () => {
    const mod = await loadMock()
    expect(mod.workspace.getConfiguration('explorer').inspect('confirmDelete')).toBeUndefined()
  })

  test('get reads workspaceFolder > workspace > global > default precedence', async () => {
    const mod = await loadMock()
    vscode.state.setConfigurationDetail('explorer.confirmDelete', {
      defaultValue: true,
      globalValue: true,
      workspaceValue: false,
    })
    const cfg = mod.workspace.getConfiguration('explorer')
    // workspaceValue overrides globalValue and defaultValue
    expect(cfg.get<boolean>('confirmDelete')).toBe(false)
  })

  test('save → mutate → restore flow (explorer-delete pattern) works', async () => {
    const mod = await loadMock()
    vscode.state.setConfigurationDetail('explorer.confirmDelete', { globalValue: true })
    const cfg = mod.workspace.getConfiguration('explorer')
    const original = cfg.inspect<boolean>('confirmDelete')?.globalValue
    expect(original).toBe(true)
    await cfg.update('confirmDelete', false, mod.ConfigurationTarget.Global)
    expect(cfg.inspect<boolean>('confirmDelete')?.globalValue).toBe(false)
    await cfg.update('confirmDelete', original, mod.ConfigurationTarget.Global)
    expect(cfg.inspect<boolean>('confirmDelete')?.globalValue).toBe(true)
  })
})

describe('window.setStatusBarMessage', () => {
  test('records messages with timeout', async () => {
    const mod = await loadMock()
    mod.window.setStatusBarMessage('hello', 1500)
    mod.window.setStatusBarMessage('world')
    const msgs = vscode.state.getStatusBarMessages()
    expect(msgs).toEqual([
      { message: 'hello', hideAfterTimeout: 1500 },
      { message: 'world', hideAfterTimeout: undefined },
    ])
  })

  test('returns Disposable shape', async () => {
    const mod = await loadMock()
    const d = mod.window.setStatusBarMessage('x', 100)
    expect(typeof d.dispose).toBe('function')
  })
})

describe('window.showInputBox', () => {
  test('returns nextInputBoxResult and records call', async () => {
    const mod = await loadMock()
    vscode.state.setNextInputBoxResult('newName')
    const result = await mod.window.showInputBox({ prompt: 'Rename to…' })
    expect(result).toBe('newName')
    const recorded = vscode.state.getShownInputBoxes()
    expect(recorded.length).toBe(1)
  })

  test('returns undefined when no next result is set', async () => {
    const mod = await loadMock()
    expect(await mod.window.showInputBox()).toBeUndefined()
  })
})

describe('window.tabGroups', () => {
  test('all reflects state.setTabs', async () => {
    const mod = await loadMock()
    vscode.state.setTabs([
      { label: 'a.ts', isPinned: false },
      { label: 'b.ts', isPinned: true },
    ])
    const groups = mod.window.tabGroups.all
    expect(groups.length).toBe(1)
    expect(groups[0]?.tabs.length).toBe(2)
  })

  test('close removes tabs and records them', async () => {
    const mod = await loadMock()
    const a = { label: 'a.ts', isPinned: false }
    const b = { label: 'b.ts', isPinned: true }
    vscode.state.setTabs([a, b])
    await mod.window.tabGroups.close([a])
    expect(mod.window.tabGroups.all[0]?.tabs).toEqual([b])
    expect(vscode.state.getClosedTabs()).toEqual([a])
  })

  test('closeUnpinnedTabs flow: filter → close → state reflects only pinned', async () => {
    const mod = await loadMock()
    const t1 = { label: 'a.ts', isPinned: false }
    const t2 = { label: 'b.ts', isPinned: true }
    const t3 = { label: 'c.ts', isPinned: false }
    vscode.state.setTabGroups([{ tabs: [t1, t2] }, { tabs: [t3] }])
    const unpinned = mod.window.tabGroups.all.flatMap((g) => g.tabs.filter((t) => !t.isPinned))
    expect(unpinned.length).toBe(2)
    await mod.window.tabGroups.close(unpinned)
    const remaining = mod.window.tabGroups.all.flatMap((g) => g.tabs)
    expect(remaining).toEqual([t2])
  })
})

describe('TextDocument', () => {
  test('openDocument registers a doc; openTextDocument finds it', async () => {
    const mod = await loadMock()
    vscode.state.openDocument('file:///x.ts', 'hello world')
    const doc = await mod.workspace.openTextDocument(mod.Uri.parse('file:///x.ts'))
    expect(doc.getText()).toBe('hello world')
  })

  test('getText with range slices correctly across lines', async () => {
    const mod = await loadMock()
    const doc = vscode.state.openDocument('file:///x.ts', 'line0\nline1\nline2')
    const range = new mod.Range(new mod.Position(0, 2), new mod.Position(2, 3))
    expect(doc.getText(range)).toBe('ne0\nline1\nlin')
  })

  test('getWordRangeAtPosition finds identifier under cursor', async () => {
    const mod = await loadMock()
    const doc = vscode.state.openDocument('file:///x.ts', 'const myVar = 1')
    const r = doc.getWordRangeAtPosition(new mod.Position(0, 9))
    expect(r).toBeDefined()
    expect(r?.start.character).toBe(6)
    expect(r?.end.character).toBe(11)
    expect(doc.getText(r)).toBe('myVar')
  })

  test('getWordRangeAtPosition returns undefined on whitespace', async () => {
    const mod = await loadMock()
    // "abc   def" — position 4 sits in the middle of the three-space gap, so
    // it cannot be inside either identifier regardless of inclusive-end
    // semantics.
    const doc = vscode.state.openDocument('file:///x.ts', 'abc   def')
    expect(doc.getWordRangeAtPosition(new mod.Position(0, 4))).toBeUndefined()
  })

  test('lineAt returns text and full-line range', () => {
    const doc = vscode.state.openDocument('file:///x.ts', 'first\nsecond\nthird')
    const line = doc.lineAt(1)
    expect(line.text).toBe('second')
    expect(line.range.end.character).toBe(6)
  })

  test('lineCount counts lines', () => {
    const doc = vscode.state.openDocument('file:///x.ts', 'a\nb\nc')
    expect(doc.lineCount).toBe(3)
  })
})

describe('window.activeTextEditor', () => {
  test('setActiveCursor wires editor.document and editor.selection.active', async () => {
    const mod = await loadMock()
    vscode.state.setActiveCursor('file:///x.ts', 'const foo = 1', { line: 0, character: 8 })
    const editor = mod.window.activeTextEditor
    if (!editor) throw new Error('expected active editor')
    expect(editor.selection.active.character).toBe(8)
    expect(editor.document.getText()).toBe('const foo = 1')
  })

  test('reset clears active editor', async () => {
    const mod = await loadMock()
    vscode.state.setActiveCursor('file:///x.ts', 'x', { line: 0, character: 0 })
    expect(mod.window.activeTextEditor).toBeDefined()
    vscode.reset()
    expect(mod.window.activeTextEditor).toBeUndefined()
  })
})

describe('WorkspaceEdit + workspace.applyEdit', () => {
  test('replace + entries groups edits per uri', async () => {
    const mod = await loadMock()
    const u = mod.Uri.file('/x.ts')
    const v = mod.Uri.file('/y.ts')
    const edit = new mod.WorkspaceEdit()
    edit.replace(u, new mod.Range(0, 0, 0, 5), 'aaaaa')
    edit.replace(v, new mod.Range(0, 0, 0, 3), 'bbb')
    edit.replace(u, new mod.Range(1, 0, 1, 4), 'cccc')
    const entries = edit.entries()
    expect(entries.length).toBe(2)
    const uEntry = entries.find(([uri]) => uri.toString() === u.toString())
    expect(uEntry?.[1].length).toBe(2)
  })

  test('applyEdit rewrites doc text using sorted-descending offsets', async () => {
    const mod = await loadMock()
    const u = mod.Uri.file('/x.ts')
    vscode.state.openDocument(u, 'foo bar baz')
    const edit = new mod.WorkspaceEdit()
    // Two non-overlapping replaces — applied in sorted-descending order so
    // the earlier one's offset isn't shifted by the later one.
    edit.replace(u, new mod.Range(0, 0, 0, 3), 'xxx') // foo → xxx
    edit.replace(u, new mod.Range(0, 8, 0, 11), 'zzz') // baz → zzz
    await mod.workspace.applyEdit(edit)
    const doc = await mod.workspace.openTextDocument(u)
    expect(doc.getText()).toBe('xxx bar zzz')
  })

  test('applyEdit handles cross-line full-document replace', async () => {
    const mod = await loadMock()
    const u = mod.Uri.file('/x.ts')
    const doc = vscode.state.openDocument(u, 'first\nsecond\nthird')
    const edit = new mod.WorkspaceEdit()
    const lastLine = doc.lineCount - 1
    const lastCol = doc.lineAt(lastLine).range.end.character
    edit.replace(
      u,
      new mod.Range(new mod.Position(0, 0), new mod.Position(lastLine, lastCol)),
      'a\nb\nc',
    )
    await mod.workspace.applyEdit(edit)
    expect((await mod.workspace.openTextDocument(u)).getText()).toBe('a\nb\nc')
  })

  test('applyEdit records the edit on __state', async () => {
    const mod = await loadMock()
    const edit = new mod.WorkspaceEdit()
    edit.replace(mod.Uri.file('/x.ts'), new mod.Range(0, 0, 0, 1), 'X')
    await mod.workspace.applyEdit(edit)
    expect(vscode.state.getAppliedEdits().length).toBe(1)
  })

  test('applyEdit on missing doc no-ops cleanly', async () => {
    const mod = await loadMock()
    const edit = new mod.WorkspaceEdit()
    edit.replace(mod.Uri.file('/missing.ts'), new mod.Range(0, 0, 0, 1), 'X')
    const ok = await mod.workspace.applyEdit(edit)
    expect(ok).toBe(true)
  })
})

describe('reset() clears all new state', () => {
  test('reset clears statusBar, inputBoxes, tabs, docs, edits, activeEditor', async () => {
    const mod = await loadMock()
    mod.window.setStatusBarMessage('m')
    vscode.state.setNextInputBoxResult('x')
    await mod.window.showInputBox()
    vscode.state.setTabs([{ label: 'a', isPinned: false }])
    vscode.state.openDocument('file:///x.ts', 'x')
    vscode.state.setActiveCursor('file:///y.ts', 'y', { line: 0, character: 0 })
    const edit = new mod.WorkspaceEdit()
    edit.replace(mod.Uri.file('/x.ts'), new mod.Range(0, 0, 0, 1), 'X')
    await mod.workspace.applyEdit(edit)

    vscode.reset()

    expect(vscode.state.getStatusBarMessages()).toEqual([])
    expect(vscode.state.getShownInputBoxes()).toEqual([])
    expect(vscode.state.getTabGroups()).toEqual([])
    expect(vscode.state.getDocuments()).toEqual([])
    expect(vscode.state.getAppliedEdits()).toEqual([])
    expect(mod.window.activeTextEditor).toBeUndefined()
  })
})
