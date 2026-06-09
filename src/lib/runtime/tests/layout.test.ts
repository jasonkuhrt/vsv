import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { Layout } from '../layout.ts'

/** Run `Layout.apply` against a recording dispatcher; return the emitted ids. */
const emitted = (layout: Layout): Array<string> => {
  const ids: Array<string> = []
  const dispatcher = {
    executeCommandRaw: (id: string): Effect.Effect<unknown> =>
      Effect.sync(() => {
        ids.push(id)
      }),
  }
  Effect.runSync(Layout.apply(dispatcher, layout))
  return ids
}

describe('Layout.apply emits the correct absolute-command sequence', () => {
  test("'all' — restore aux, hide panel, show sidebar + aux, focus terminal", () => {
    expect(
      emitted({ sideBar: 'visible', panel: 'hidden', auxiliaryBar: 'visible', focus: 'terminal' }),
    ).toEqual([
      'workbench.action.restoreAuxiliaryBar',
      'workbench.action.closePanel',
      'workbench.action.focusSideBar',
      'workbench.action.focusAuxiliaryBar',
      'workbench.action.terminal.focus',
    ])
  })

  test("'explorer' — restore aux, hide panel + aux, show sidebar, focus explorer", () => {
    expect(
      emitted({ sideBar: 'visible', panel: 'hidden', auxiliaryBar: 'hidden', focus: 'explorer' }),
    ).toEqual([
      'workbench.action.restoreAuxiliaryBar',
      'workbench.action.closePanel',
      'workbench.action.closeAuxiliaryBar',
      'workbench.action.focusSideBar',
      'workbench.files.action.focusFilesExplorer',
    ])
  })

  test("'full-terminal' — open + maximize aux, focus terminal (no per-part commands)", () => {
    expect(emitted({ auxiliaryBar: 'maximized', focus: 'terminal' })).toEqual([
      'workbench.action.focusAuxiliaryBar',
      'workbench.action.maximizeAuxiliaryBar',
      'workbench.action.terminal.focus',
    ])
  })
})

describe('Layout.apply ordering invariants', () => {
  test('un-maximize precedes every per-part command (so restore cannot clobber hides/shows)', () => {
    // Regression guard for the maximize-restore cross-part side effect: when the
    // target is not 'maximized', restoreAuxiliaryBar must be emitted FIRST.
    const ids = emitted({ sideBar: 'hidden', panel: 'visible', auxiliaryBar: 'visible' })
    expect(ids[0]).toBe('workbench.action.restoreAuxiliaryBar')
    expect(ids.indexOf('workbench.action.restoreAuxiliaryBar')).toBeLessThan(
      ids.indexOf('workbench.action.closeSidebar'),
    )
  })

  test('focus is always emitted last', () => {
    const ids = emitted({ sideBar: 'visible', auxiliaryBar: 'hidden', focus: 'editor' })
    expect(ids[ids.length - 1]).toBe('workbench.action.focusActiveEditorGroup')
  })

  test('hiding the auxiliary bar restores it first (reopens un-maximized)', () => {
    const ids = emitted({ auxiliaryBar: 'hidden' })
    expect(ids.indexOf('workbench.action.restoreAuxiliaryBar')).toBeLessThan(
      ids.indexOf('workbench.action.closeAuxiliaryBar'),
    )
  })
})

describe('Layout.apply is idempotent / state-independent', () => {
  test('applying the same target twice emits the same sequence', () => {
    const target: Layout = {
      sideBar: 'visible',
      panel: 'hidden',
      auxiliaryBar: 'visible',
      focus: 'terminal',
    }
    expect(emitted(target)).toEqual(emitted(target))
  })

  test('never emits a toggle command', () => {
    const targets: Array<Layout> = [
      { sideBar: 'visible', panel: 'hidden', auxiliaryBar: 'visible', focus: 'terminal' },
      { sideBar: 'visible', panel: 'hidden', auxiliaryBar: 'hidden', focus: 'explorer' },
      { auxiliaryBar: 'maximized', focus: 'terminal' },
    ]
    const all = targets.flatMap(emitted)
    expect(all).not.toContain('workbench.action.toggleMaximizedAuxiliaryBar')
    expect(all).not.toContain('workbench.action.toggleAuxiliaryBar')
    expect(all).not.toContain('workbench.action.toggleSidebarVisibility')
    expect(all).not.toContain('workbench.action.togglePanel')
  })

  test('omitted fields emit no command for that surface (untouched aux is not un-maximized)', () => {
    // Only focus requested, aux bar omitted → no restore/close/show at all,
    // just the focus. Applying an unrelated field must not touch the aux bar.
    expect(emitted({ focus: 'sideBar' })).toEqual(['workbench.action.focusSideBar'])
  })
})
