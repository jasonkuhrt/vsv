import { Schema } from 'effect'
import { describe, expect, test } from 'bun:test'
import {
  CommandDecl,
  ConfigDecl,
  ContextKeyDecl,
  Manifest,
  StateDecl,
} from '../../manifest/schema.ts'
import { emitRegistries } from '../emit-registries.ts'

describe('emitRegistries', () => {
  test('empty manifest emits empty registries with header', () => {
    const m = Manifest.make({ name: 'empty-ext' })
    const out = emitRegistries(m)
    expect(out).toContain('// GENERATED')
    expect(out).toContain('export type CommandRegistry = {')
    expect(out).toContain('export type ContextKeyRegistry = {')
    expect(out).toContain('export type ConfigRegistry = {')
    expect(out).toContain('export type StateRegistry = {')
  })

  test('emits command entries with args and result types', () => {
    const m = Manifest.make({
      name: 'ext',
      commands: [
        CommandDecl.make({
          id: 'ext.greet',
          args: Schema.Struct({ name: Schema.String }),
          result: Schema.String,
        }),
      ],
    })
    const out = emitRegistries(m)
    expect(out).toContain('"ext.greet"')
    expect(out).toContain('"name": string')
    expect(out).toContain('result: string')
  })

  test('emits context keys', () => {
    const m = Manifest.make({
      name: 'ext',
      contextKeys: [
        ContextKeyDecl.make({
          name: 'ext.active',
          valueType: Schema.Boolean,
        }),
      ],
    })
    const out = emitRegistries(m)
    expect(out).toContain('"ext.active": boolean')
  })

  test('emits config entries', () => {
    const m = Manifest.make({
      name: 'ext',
      config: [
        ConfigDecl.make({
          key: 'ext.enabled',
          valueSchema: Schema.Boolean,
        }),
      ],
    })
    const out = emitRegistries(m)
    expect(out).toContain('"ext.enabled": boolean')
  })

  test('emits state entries with scope', () => {
    const m = Manifest.make({
      name: 'ext',
      state: [
        StateDecl.make({
          key: 'ext.lastRun',
          scope: 'global',
          valueSchema: Schema.Number,
        }),
      ],
    })
    const out = emitRegistries(m)
    expect(out).toContain('"ext.lastRun"')
    expect(out).toContain('value: number')
    expect(out).toContain('scope: "global"')
  })
})
