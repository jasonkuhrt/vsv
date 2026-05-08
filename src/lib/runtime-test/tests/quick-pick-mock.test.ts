// Tests for the createQuickPick (stateful) mock — distinct from
// showQuickPick (Promise-returning), which is covered by install-mock.test.ts.
//
// The stateful API is the one consumer extensions reach for when they need
// instant-resolve-on-typing / activeItems / change-value events. These
// tests exercise the lifecycle (show/hide/dispose), the event-listener
// registration path, the test-only `__fire*` escape hatches, and the
// observable state on the mock root.

import { beforeEach, describe, expect, test } from 'bun:test'
import { installVSCodeMock } from '../install-mock.ts'
import type { QuickPickItem } from '../vscode-mock.ts'
import '../matchers.ts'

const vscode = installVSCodeMock()

const loadMock = async (): Promise<typeof import('../vscode-mock.ts')> =>
  (await import('vscode')) as unknown as typeof import('../vscode-mock.ts')

beforeEach(() => {
  vscode.reset()
})

describe('createQuickPick', () => {
  test('returns a MockQuickPick with default state', async () => {
    const mod = await loadMock()
    const qp = mod.window.createQuickPick()

    expect(qp.title).toBe('')
    expect(qp.matchOnDescription).toBe(false)
    expect(qp.items).toEqual([])
    expect(qp.shown).toBe(false)
    expect(qp.disposed).toBe(false)
  })

  test('records every instance in state.createdQuickPicks', async () => {
    const mod = await loadMock()
    expect(vscode.state.getCreatedQuickPicks()).toHaveLength(0)

    const a = mod.window.createQuickPick()
    const b = mod.window.createQuickPick()

    expect(vscode.state.getCreatedQuickPicks()).toEqual([a, b])
    expect(vscode.state.getLastCreatedQuickPick()).toBe(b)
  })

  test('typed item parameter flows through items field', async () => {
    interface MyItem extends QuickPickItem {
      readonly key: string
    }
    const mod = await loadMock()
    const qp = mod.window.createQuickPick<MyItem>()
    const items: MyItem[] = [
      { label: 'A', key: 'a' },
      { label: 'B', key: 'b' },
    ]
    qp.items = items
    expect(qp.items).toBe(items)
  })

  test('show() sets shown=true; dispose() sets disposed=true and shown=false', async () => {
    const mod = await loadMock()
    const qp = mod.window.createQuickPick()

    qp.show()
    expect(qp.shown).toBe(true)
    expect(qp.disposed).toBe(false)

    qp.dispose()
    expect(qp.shown).toBe(false)
    expect(qp.disposed).toBe(true)
  })
})

describe('event listeners', () => {
  test('onDidChangeValue fires when __fireChangeValue is called', async () => {
    const mod = await loadMock()
    const qp = mod.window.createQuickPick()
    const calls: string[] = []
    qp.onDidChangeValue((v) => calls.push(v))

    qp.__fireChangeValue('foo')
    qp.__fireChangeValue('bar')

    expect(calls).toEqual(['foo', 'bar'])
    expect(qp.value).toBe('bar')
  })

  test('onDidAccept fires when __fireAccept is called', async () => {
    const mod = await loadMock()
    const qp = mod.window.createQuickPick()
    let count = 0
    qp.onDidAccept(() => {
      count += 1
    })

    qp.__fireAccept()
    qp.__fireAccept()

    expect(count).toBe(2)
  })

  test('onDidHide fires only when picker is shown', async () => {
    const mod = await loadMock()
    const qp = mod.window.createQuickPick()
    let count = 0
    qp.onDidHide(() => {
      count += 1
    })

    // Not shown — fire is a no-op
    qp.__fireHide()
    expect(count).toBe(0)

    qp.show()
    qp.__fireHide()
    expect(count).toBe(1)
    expect(qp.shown).toBe(false)
  })

  test('disposable returned by onDid* removes the listener', async () => {
    const mod = await loadMock()
    const qp = mod.window.createQuickPick()
    let count = 0
    const sub = qp.onDidChangeValue(() => {
      count += 1
    })

    qp.__fireChangeValue('x')
    expect(count).toBe(1)

    sub.dispose()
    qp.__fireChangeValue('y')
    expect(count).toBe(1)
  })

  test('dispose() removes all listeners', async () => {
    const mod = await loadMock()
    const qp = mod.window.createQuickPick()
    let count = 0
    qp.onDidChangeValue(() => {
      count += 1
    })
    qp.onDidAccept(() => {
      count += 1
    })

    qp.dispose()
    qp.__fireChangeValue('x')
    qp.__fireAccept()

    expect(count).toBe(0)
  })
})

describe('reset', () => {
  test('clears state.createdQuickPicks', async () => {
    const mod = await loadMock()
    mod.window.createQuickPick()
    mod.window.createQuickPick()
    expect(vscode.state.getCreatedQuickPicks()).toHaveLength(2)

    vscode.reset()
    expect(vscode.state.getCreatedQuickPicks()).toHaveLength(0)
  })
})
