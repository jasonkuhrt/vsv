import { Schema } from 'effect'
import { describe, expect, test } from 'bun:test'
import { schemaToTs } from '../schema-to-ts.ts'

describe('schemaToTs', () => {
  test('primitives', () => {
    expect(schemaToTs(Schema.String)).toBe('string')
    expect(schemaToTs(Schema.Number)).toBe('number')
    expect(schemaToTs(Schema.Boolean)).toBe('boolean')
    expect(schemaToTs(Schema.Void)).toBe('void')
    expect(schemaToTs(Schema.Undefined)).toBe('undefined')
    expect(schemaToTs(Schema.Unknown)).toBe('unknown')
  })

  test('literals', () => {
    expect(schemaToTs(Schema.Literal('foo'))).toBe('"foo"')
    expect(schemaToTs(Schema.Literal(42))).toBe('42')
    expect(schemaToTs(Schema.Literal(true))).toBe('true')
    expect(schemaToTs(Schema.Null)).toBe('null')
  })

  test('array', () => {
    expect(schemaToTs(Schema.Array(Schema.String))).toBe('Array<string>')
  })

  test('struct emits indented object literal', () => {
    const out = schemaToTs(
      Schema.Struct({
        name: Schema.String,
        age: Schema.Number,
      }),
    )
    expect(out).toContain('"name": string')
    expect(out).toContain('"age": number')
  })

  test('struct with optional property', () => {
    const out = schemaToTs(
      Schema.Struct({
        name: Schema.String,
        nickname: Schema.optional(Schema.String),
      }),
    )
    expect(out).toContain('"nickname"?: string')
  })

  test('union', () => {
    const out = schemaToTs(Schema.Union(Schema.Literal('on'), Schema.Literal('off')))
    expect(out).toBe('"on" | "off"')
  })

  test('record', () => {
    const out = schemaToTs(Schema.Record({ key: Schema.String, value: Schema.Number }))
    expect(out).toBe('Record<string, number>')
  })

  test('nested struct', () => {
    const out = schemaToTs(
      Schema.Struct({
        point: Schema.Struct({
          x: Schema.Number,
          y: Schema.Number,
        }),
      }),
    )
    expect(out).toContain('"x": number')
    expect(out).toContain('"y": number')
    expect(out).toContain('"point"')
  })
})
