import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { OpenEnum } from '../open-enum.ts'

// A representative VS Code-style extensible context-key domain: a known core
// membership plus an open tail for runtime-registered languages.
const EditorLangId = OpenEnum('editorLangId', {
  typescript: 'typescript',
  markdown: 'markdown',
})

const decode = Schema.decodeUnknownSync(EditorLangId)

describe('OpenEnum', () => {
  describe('decode', () => {
    test('a known value decodes to { value }', () => {
      expect(decode({ value: 'markdown' })).toEqual({ value: 'markdown' })
    })

    test('an unrecognized value decodes to { found, value: "unknown" } preserving the raw string', () => {
      expect(decode({ found: 'rescript', value: 'unknown' })).toEqual({
        found: 'rescript',
        value: 'unknown',
      })
    })

    test('a non-member without the unknown wrapper is rejected', () => {
      // The tagged contract requires unrecognized values to arrive already
      // wrapped as { found, value:'unknown' }; a bare unknown string fails.
      expect(() => decode({ value: 'rescript' })).toThrow()
    })
  })

  describe('makeFrom', () => {
    test('narrows a known value to the { value } known shape', () => {
      const result = EditorLangId.makeFrom('typescript')
      expect(result).toEqual({ value: 'typescript' })
      // Decodes cleanly as the known sub-schema.
      expect(EditorLangId.Known.is(result)).toBe(true)
      expect(EditorLangId.Unknown.is(result)).toBe(false)
    })

    test('narrows an unknown value to the { found, value:"unknown" } shape, preserving the raw string', () => {
      const result = EditorLangId.makeFrom('rescript')
      expect(result).toEqual({ found: 'rescript', value: 'unknown' })
      expect(EditorLangId.Unknown.is(result)).toBe(true)
      expect(EditorLangId.Known.is(result)).toBe(false)
    })
  })

  describe('TypeClosed (the bare known-string union)', () => {
    const isClosed = EditorLangId.Closed.is

    test('accepts each known member string directly', () => {
      expect(isClosed('typescript')).toBe(true)
      expect(isClosed('markdown')).toBe(true)
    })

    test('rejects an unknown string', () => {
      expect(isClosed('rescript')).toBe(false)
    })

    test('rejects the tagged struct shapes (Closed is the bare string union, not the union of structs)', () => {
      expect(isClosed({ value: 'markdown' })).toBe(false)
      expect(isClosed({ found: 'rescript', value: 'unknown' })).toBe(false)
    })
  })

  describe('sub-schemas', () => {
    test('Open accepts every known member as a bare string', () => {
      expect(EditorLangId.Open.is('typescript')).toBe(true)
      expect(EditorLangId.Open.is('markdown')).toBe(true)
      expect(EditorLangId.Open.is('rescript')).toBe(false)
    })

    test('the union schema is accepts both arms', () => {
      expect(EditorLangId.is({ value: 'markdown' })).toBe(true)
      expect(EditorLangId.is({ found: 'rescript', value: 'unknown' })).toBe(true)
      expect(EditorLangId.is({ value: 'rescript' })).toBe(false)
    })
  })
})
