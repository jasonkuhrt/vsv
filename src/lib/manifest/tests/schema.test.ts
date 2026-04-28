import { Schema } from 'effect'
import { describe, expect, test } from 'bun:test'
import { CommandDecl, Manifest } from '../schema.ts'

describe('Manifest', () => {
  test('constructs via .make with minimal fields', () => {
    const m = Manifest.make({ name: 'my-ext', publisher: 'jasonkuhrt' })
    expect(m._tag).toBe('Manifest')
    expect(m.name).toBe('my-ext')
    expect(m.publisher).toBe('jasonkuhrt')
    expect(m.displayName).toBeUndefined()
    expect(m.commands).toBeUndefined()
  })

  test('constructs via .make with full fields', () => {
    const cmd = CommandDecl.make({
      id: 'my-ext.doThing',
      args: Schema.String,
      result: Schema.Void,
      title: 'Do Thing',
      category: 'My Ext',
    })
    const m = Manifest.make({
      name: 'my-ext',
      displayName: 'My Extension',
      description: 'Does things',
      publisher: 'jasonkuhrt',
      version: '1.0.0',
      engineVscode: '^1.90.0',
      activationEvents: ['onStartupFinished'],
      extensionDependencies: ['ms-vscode.some-ext'],
      commands: [cmd],
    })
    expect(m.name).toBe('my-ext')
    expect(m.commands?.[0]?.id).toBe('my-ext.doThing')
    expect(m.activationEvents).toEqual(['onStartupFinished'])
  })

  test('decodes a plain object via decodeUnknownSync', () => {
    const raw = {
      _tag: 'Manifest',
      name: 'decoded-ext',
      publisher: 'jasonkuhrt',
      displayName: 'Decoded',
    }
    const decoded = Schema.decodeUnknownSync(Manifest)(raw)
    expect(decoded._tag).toBe('Manifest')
    expect(decoded.name).toBe('decoded-ext')
    expect(decoded.publisher).toBe('jasonkuhrt')
    expect(decoded.displayName).toBe('Decoded')
  })

  test('round-trip: encode then decode', () => {
    const original = Manifest.make({
      name: 'roundtrip',
      publisher: 'jasonkuhrt',
      description: 'test',
    })
    const encoded = Schema.encodeSync(Manifest)(original)
    const decoded = Schema.decodeUnknownSync(Manifest)(encoded)
    expect(decoded.name).toBe(original.name)
    expect(decoded.description).toBe(original.description)
    expect(decoded._tag).toBe('Manifest')
  })

  test('rejects missing required fields', () => {
    expect(() => Schema.decodeUnknownSync(Manifest)({ _tag: 'Manifest' })).toThrow()
  })

  test('rejects missing publisher', () => {
    expect(() => Schema.decodeUnknownSync(Manifest)({ _tag: 'Manifest', name: 'no-pub' })).toThrow()
  })

  test('rejects empty publisher', () => {
    expect(() =>
      Schema.decodeUnknownSync(Manifest)({
        _tag: 'Manifest',
        name: 'ext',
        publisher: '',
      }),
    ).toThrow()
  })

  test('rejects empty name (NonEmptyTrimmedString)', () => {
    expect(() => Schema.decodeUnknownSync(Manifest)({ _tag: 'Manifest', name: '' })).toThrow()
  })

  test('rejects whitespace-only name (NonEmptyTrimmedString)', () => {
    expect(() => Schema.decodeUnknownSync(Manifest)({ _tag: 'Manifest', name: '   ' })).toThrow()
  })
})

describe('CommandDecl', () => {
  test('constructs via .make', () => {
    const cmd = CommandDecl.make({
      id: 'foo.bar',
      args: Schema.Void,
      result: Schema.Void,
    })
    expect(cmd._tag).toBe('CommandDecl')
    expect(cmd.id).toBe('foo.bar')
  })

  test('rejects empty id', () => {
    expect(() =>
      Schema.decodeUnknownSync(CommandDecl)({
        _tag: 'CommandDecl',
        id: '',
        args: null,
        result: null,
      }),
    ).toThrow()
  })
})
