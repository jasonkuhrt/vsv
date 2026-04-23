import { beforeEach, describe, expect, test } from 'bun:test'
import { noUnregisteredContextKey } from '../rules/no-unregistered-context-key.ts'

interface Report {
  messageId: string
  data?: Record<string, string>
}

const runRule = (astCalls: unknown[], registry: ReadonlySet<string> | undefined): Report[] => {
  const reports: Report[] = []
  const context = {
    report: (d: { node: unknown; messageId: string; data?: Record<string, string> }): void => {
      const r: Report = { messageId: d.messageId }
      if (d.data !== undefined) r.data = d.data
      reports.push(r)
    },
    settings: registry !== undefined ? { vsvContextKeys: registry } : {},
  }
  const listener = noUnregisteredContextKey.create(context)
  for (const call of astCalls) {
    listener.CallExpression?.(call)
  }
  return reports
}

const makeDefineContextKeyCall = (key: string) => ({
  type: 'CallExpression',
  callee: {
    type: 'MemberExpression',
    object: { type: 'Identifier', name: 'runtime' },
    property: { type: 'Identifier', name: 'defineContextKey' },
  },
  arguments: [{ type: 'Literal', value: key }],
})

const makeSetContextCall = (key: string) => ({
  type: 'CallExpression',
  callee: {
    type: 'MemberExpression',
    object: {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'vscode' },
      property: { type: 'Identifier', name: 'commands' },
    },
    property: { type: 'Identifier', name: 'executeCommand' },
  },
  arguments: [
    { type: 'Literal', value: 'setContext' },
    { type: 'Literal', value: key },
  ],
})

describe('noUnregisteredContextKey', () => {
  let registry: ReadonlySet<string>

  beforeEach(() => {
    registry = new Set(['ext.known'])
  })

  test('allows registered key in defineContextKey', () => {
    const reports = runRule([makeDefineContextKeyCall('ext.known')], registry)
    expect(reports).toEqual([])
  })

  test('flags unregistered key in defineContextKey', () => {
    const reports = runRule([makeDefineContextKeyCall('ext.unknown')], registry)
    expect(reports.length).toBe(1)
    expect(reports[0]?.messageId).toBe('unregistered')
    expect(reports[0]?.data?.['key']).toBe('ext.unknown')
  })

  test('flags unregistered key in setContext', () => {
    const reports = runRule([makeSetContextCall('ext.unknown')], registry)
    expect(reports.length).toBe(1)
    expect(reports[0]?.messageId).toBe('unregistered')
  })

  test('allows registered key in setContext', () => {
    const reports = runRule([makeSetContextCall('ext.known')], registry)
    expect(reports).toEqual([])
  })

  test('emits missingRegistry diagnostic when registry is undefined', () => {
    const reports = runRule([makeDefineContextKeyCall('anything')], undefined)
    expect(reports.length).toBe(1)
    expect(reports[0]?.messageId).toBe('missingRegistry')
  })

  test('ignores unrelated calls', () => {
    const unrelated = {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'x' },
        property: { type: 'Identifier', name: 'other' },
      },
      arguments: [{ type: 'Literal', value: 'ext.unknown' }],
    }
    const reports = runRule([unrelated], registry)
    expect(reports).toEqual([])
  })
})
