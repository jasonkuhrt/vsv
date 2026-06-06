import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { coreCommands } from '../commands.ts'
import {
  booleanContextKeys,
  closedStringContextKeys,
  coreContextKeys,
  editorLangId,
  numericContextKeys,
  openStringContextKeys,
} from '../context-keys.ts'
import { builtinsManifest } from '../manifest.ts'

describe('builtinsManifest', () => {
  test('assembles into a valid Manifest', () => {
    expect(builtinsManifest._tag).toBe('Manifest')
    expect(builtinsManifest.publisher).toBe('vscode')
  })

  test('externalContextKeys is the full coreContextKeys catalog', () => {
    const externalCount: number = builtinsManifest.externalContextKeys.length
    const coreCount: number = coreContextKeys.length
    const domainSum: number =
      booleanContextKeys.length +
      numericContextKeys.length +
      closedStringContextKeys.length +
      openStringContextKeys.length
    expect(externalCount).toBe(coreCount)
    expect(coreCount).toBe(domainSum)
  })

  test('externalCommands is the full coreCommands catalog', () => {
    expect(builtinsManifest.externalCommands.length).toBe(coreCommands.length)
  })

  test('every context-key decl is a well-formed ExternalContextKeyDecl', () => {
    for (const decl of coreContextKeys) {
      expect(decl._tag).toBe('ExternalContextKeyDecl')
      expect(decl.name.length).toBeGreaterThan(0)
      expect(decl.ownedBy).toBe('vscode core')
      expect(Schema.isSchema(decl.valueType)).toBe(true)
    }
  })

  test('every command decl is a well-formed ExternalCommandDecl', () => {
    for (const decl of coreCommands) {
      expect(decl._tag).toBe('ExternalCommandDecl')
      expect(decl.id.length).toBeGreaterThan(0)
      expect(decl.fromExtension).toBe('vscode core')
    }
  })

  test('context-key names are unique (no accidental same-name merges)', () => {
    const names = coreContextKeys.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  test('command ids are unique', () => {
    const ids = coreCommands.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the OpenEnum-typed editorLangId decodes a known and an unknown value', () => {
    const decode = Schema.decodeUnknownSync(editorLangId.valueType)
    expect(decode({ value: 'typescript' })).toEqual({ value: 'typescript' })
    expect(decode({ found: 'rescript', value: 'unknown' })).toEqual({
      found: 'rescript',
      value: 'unknown',
    })
  })
})
