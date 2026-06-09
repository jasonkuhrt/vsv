import { Effect } from 'effect'
import type { CommandExecutionError } from './errors.ts'

/**
 * Declarative target state for VS Code's workbench layout.
 *
 * Each field names a desired END STATE, not an operation. {@link Layout.apply}
 * realizes it by issuing VS Code's *absolute* layout commands (close / focus /
 * maximize / restore), every one of which is idempotent: applying the same
 * target twice — or from any starting layout — converges to the same result.
 *
 * There is deliberately no toggle variant and no current-state read. The
 * classic failure mode (an extension tracks layout in a cache that drifts from
 * reality, then mis-fires relative toggles) is therefore **unrepresentable**.
 *
 * The type is a discriminated union: maximizing the auxiliary bar force-hides
 * the side bar and panel, so the `'maximized'` variant omits those fields
 * entirely — a contradictory target like `{ sideBar: 'visible', auxiliaryBar:
 * 'maximized' }` is a *compile error*, not a silently-lost field.
 *
 * Omitted fields are left untouched.
 */
export type Layout = LayoutSurfaces | LayoutMaximized

/** Auxiliary bar at normal width (or hidden), with independent side bar / panel. */
interface LayoutSurfaces {
  /** Primary side bar (Explorer / SCM / …). */
  readonly sideBar?: 'visible' | 'hidden'
  /** Bottom panel (Problems / Output / …). */
  readonly panel?: 'visible' | 'hidden'
  /**
   * Secondary side bar. `'visible'` shows it at normal width; `'hidden'` closes
   * it. For `'maximized'`, use the {@link LayoutMaximized} variant.
   *
   * (VS Code has no absolute maximize/restore for the *panel*, only a toggle, so
   * `panel: 'maximized'` is intentionally not offered — it can't be made
   * idempotent with the available commands.)
   */
  readonly auxiliaryBar?: 'visible' | 'hidden'
  readonly focus?: LayoutFocusTarget
}

/** Auxiliary bar maximized to fill the window (side bar + panel are force-hidden by VS Code). */
interface LayoutMaximized {
  readonly auxiliaryBar: 'maximized'
  readonly focus?: LayoutFocusTarget
}

/**
 * Focus destinations, each mapped to a VS Code absolute focus command.
 *
 * Note `'terminal'` focuses the terminal *service's* active instance wherever it
 * lives (panel, editor, or a view container dragged into the auxiliary bar) and
 * will reveal that surface — so pairing `focus: 'terminal'` with `panel:
 * 'hidden'` only stays consistent when the terminal is NOT panel-anchored.
 */
export type LayoutFocusTarget =
  | 'editor'
  | 'explorer'
  | 'terminal'
  | 'sideBar'
  | 'panel'
  | 'auxiliaryBar'

const FOCUS_COMMAND: Record<LayoutFocusTarget, string> = {
  editor: 'workbench.action.focusActiveEditorGroup',
  explorer: 'workbench.files.action.focusFilesExplorer',
  terminal: 'workbench.action.terminal.focus',
  sideBar: 'workbench.action.focusSideBar',
  panel: 'workbench.action.focusPanel',
  auxiliaryBar: 'workbench.action.focusAuxiliaryBar',
}

/**
 * The single runtime capability {@link apply} needs: raw command dispatch.
 * Declared structurally so any `Runtime` satisfies it with no generic coupling.
 */
interface CommandDispatcher {
  readonly executeCommandRaw: (id: string) => Effect.Effect<unknown, CommandExecutionError>
}

/**
 * Drive the workbench to `layout` using only absolute (idempotent) commands.
 *
 * Order is fixed and load-bearing. The subtlety: `restoreAuxiliaryBar`
 * (un-maximize) doesn't merely un-maximize — VS Code also restores the side
 * bar / panel visibility it captured when the bar was maximized. So the
 * un-maximize must run BEFORE the per-part hides/shows, or it clobbers them.
 *
 *  1. un-maximize the auxiliary bar first (when the target isn't `'maximized'`),
 *     absorbing that restore's cross-part side effects up front,
 *  2. hide the surfaces the target wants gone,
 *  3. show the remaining surfaces (now authoritative over step 1's restore),
 *  4. or, for a `'maximized'` target, open then maximize the auxiliary bar
 *     (which force-hides the side bar + panel — hence the union forbids them),
 *  5. apply the final focus, overriding the focus the show-commands took.
 *
 * Every issued command is absolute, so the outcome is independent of the
 * starting layout — the caller never reads, caches, or guesses current state.
 */
const apply = (
  runtime: CommandDispatcher,
  layout: Layout,
): Effect.Effect<void, CommandExecutionError> =>
  Effect.gen(function* () {
    const run = (id: string) => runtime.executeCommandRaw(id)

    if (layout.auxiliaryBar === 'maximized') {
      // Maximize force-hides the side bar + panel, so no per-part work is
      // needed (and the union guarantees none was requested).
      yield* run('workbench.action.focusAuxiliaryBar')
      yield* run('workbench.action.maximizeAuxiliaryBar')
    } else {
      // 1. Un-maximize FIRST — but only when the target actually sets the aux
      //    bar. Its restore re-shows the side bar / panel captured at maximize
      //    time, so it must land before (and be overwritten by) the explicit
      //    per-part commands. Skipped when `auxiliaryBar` is omitted, so
      //    applying an unrelated field never un-maximizes a bar left untouched.
      //    A no-op in the host when the bar isn't currently maximized.
      if (layout.auxiliaryBar !== undefined) {
        yield* run('workbench.action.restoreAuxiliaryBar')
      }

      // 2. Hides.
      if (layout.sideBar === 'hidden') yield* run('workbench.action.closeSidebar')
      if (layout.panel === 'hidden') yield* run('workbench.action.closePanel')
      if (layout.auxiliaryBar === 'hidden') yield* run('workbench.action.closeAuxiliaryBar')

      // 3. Shows.
      if (layout.sideBar === 'visible') yield* run('workbench.action.focusSideBar')
      if (layout.panel === 'visible') yield* run('workbench.action.focusPanel')
      if (layout.auxiliaryBar === 'visible') yield* run('workbench.action.focusAuxiliaryBar')
    }

    // 5. Final focus wins over the show-commands' incidental focus.
    if (layout.focus !== undefined) yield* run(FOCUS_COMMAND[layout.focus])
  })

/**
 * Workbench layout: a declarative target ({@link Layout}) plus its idempotent
 * application. `Layout.apply(runtime, target)` is the only operation.
 */
export const Layout = { apply } as const
