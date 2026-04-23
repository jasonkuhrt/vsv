import { beforeEach, describe, expect, test } from 'bun:test'
import { noUnregisteredCommand } from '../rules/no-unregistered-command.ts'

interface Report {
  messageId: string
  data?: Record<string, string>
}

const runRule = (astCalls: unknown[], registry: ReadonlySet<string> | undefined): Report[] => {
  const reports: Report[] = []
  const context = {
    report: (d: { node: unknown; messageId: string; data?: Record<string, string> }): void => {
      const report: Report = { messageId: d.messageId }
      if (d.data !== undefined) report.data = d.data
      reports.push(report)
    },
    settings: registry !== undefined ? { vsvCommandIds: registry } : {},
  }
  const listener = noUnregisteredCommand.create(context)
  for (const call of astCalls) {
    listener.CallExpression?.(call)
  }
  return reports
}

const makeCall = (method: string, firstArg: { type: string; value?: unknown }) => ({
  type: 'CallExpression',
  callee: {
    type: 'MemberExpression',
    object: { type: 'Identifier', name: 'runtime' },
    property: { type: 'Identifier', name: method },
  },
  arguments: [firstArg],
})

describe('noUnregisteredCommand', () => {
  let registry: ReadonlySet<string>

  beforeEach(() => {
    registry = new Set(['ext.known'])
  })

  test('allows a registered command id in defineCommand', () => {
    const reports = runRule(
      [makeCall('defineCommand', { type: 'Literal', value: 'ext.known' })],
      registry,
    )
    expect(reports).toEqual([])
  })

  test('flags an unregistered command id in defineCommand', () => {
    const reports = runRule(
      [makeCall('defineCommand', { type: 'Literal', value: 'ext.unknown' })],
      registry,
    )
    expect(reports.length).toBe(1)
    expect(reports[0]?.messageId).toBe('unregistered')
    expect(reports[0]?.data?.['id']).toBe('ext.unknown')
  })

  test('flags executeCommand with unregistered id', () => {
    const reports = runRule(
      [makeCall('executeCommand', { type: 'Literal', value: 'ext.unknown' })],
      registry,
    )
    expect(reports.length).toBe(1)
    expect(reports[0]?.messageId).toBe('unregistered')
  })

  test('emits missingRegistry diagnostic when registry is undefined', () => {
    const reports = runRule(
      [makeCall('defineCommand', { type: 'Literal', value: 'whatever' })],
      undefined,
    )
    expect(reports.length).toBe(1)
    expect(reports[0]?.messageId).toBe('missingRegistry')
  })

  test('ignores non-call-expression nodes', () => {
    const reports = runRule([{ type: 'NotACall' }, null, 42, 'string'], registry)
    expect(reports).toEqual([])
  })

  test('ignores non-string first argument', () => {
    const reports = runRule(
      [makeCall('defineCommand', { type: 'Identifier', value: 'variable' })],
      registry,
    )
    expect(reports).toEqual([])
  })

  test('ignores unrelated method calls', () => {
    const reports = runRule(
      [makeCall('someOtherMethod', { type: 'Literal', value: 'ext.unknown' })],
      registry,
    )
    expect(reports).toEqual([])
  })
})
