import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { defineManifest } from '#lib/manifest/define'
import { When } from '../builder.ts'
import { WhenClause } from '../when.ts'

const manifest = defineManifest({
  name: 'ext',
  publisher: 'jasonkuhrt',
  contextKeys: [
    ContextKeyDecl({ name: 'ext.ready', valueType: Schema.Boolean }),
    ContextKeyDecl({ name: 'ext.lineCount', valueType: Schema.Number }),
  ],
  externalContextKeys: [
    ExternalContextKeyDecl({
      name: 'activeCustomEditorId',
      valueType: Schema.Literal('vscode.markdown.preview.editor'),
    }),
    ExternalContextKeyDecl({ name: 'inputFocus', valueType: Schema.Boolean }),
    ExternalContextKeyDecl({ name: 'editorLangId', valueType: Schema.String }),
    // Two decls, same name, different literal — `ContextKeyValue` merges
    // them into the union `'bottom' | 'right'` (design Gap 3).
    ExternalContextKeyDecl({ name: 'panelPosition', valueType: Schema.Literal('bottom') }),
    ExternalContextKeyDecl({ name: 'panelPosition', valueType: Schema.Literal('right') }),
  ],
})

const encode = Schema.encodeSync(WhenClause)

describe('When builder', () => {
  test('is(key) produces a WhenBoolKey for declared keys', () => {
    const $ = When(manifest)
    const ast = $.is('ext.ready')
    expect(ast._tag).toBe('WhenBoolKey')
    expect(encode(ast)).toBe('ext.ready')
  })

  test('eq(key, value) produces a WhenEq for value-domain keys', () => {
    const $ = When(manifest)
    const ast = $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor')
    expect(ast._tag).toBe('WhenEq')
    expect(encode(ast)).toBe("activeCustomEditorId == 'vscode.markdown.preview.editor'")
  })

  test('and/or/not combinators compose into nested AST', () => {
    const $ = When(manifest)
    const ast = $.and(
      $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor'),
      $.not($.is('inputFocus')),
    )
    expect(ast._tag).toBe('WhenAnd')
    expect(encode(ast)).toBe(
      "(activeCustomEditorId == 'vscode.markdown.preview.editor') && (!(inputFocus))",
    )
  })

  test('or operator binds looser than and', () => {
    const $ = When(manifest)
    const ast = $.or($.and($.is('ext.ready'), $.is('inputFocus')), $.is('inputFocus'))
    expect(ast._tag).toBe('WhenOr')
    expect(encode(ast)).toBe('((ext.ready) && (inputFocus)) || (inputFocus)')
  })

  test('unsafe.raw is an explicit escape hatch', () => {
    const $ = When(manifest)
    const ast = $.unsafe.raw('some-key-vsv-cannot-type')
    expect(ast._tag).toBe('WhenUnsafeRaw')
    expect(encode(ast)).toBe('some-key-vsv-cannot-type')
  })

  test('typed key names include both contextKeys and externalContextKeys', () => {
    const $ = When(manifest)
    expect($.is('ext.ready')._tag).toBe('WhenBoolKey')
    expect($.is('activeCustomEditorId')._tag).toBe('WhenBoolKey')
    expect($.is('inputFocus')._tag).toBe('WhenBoolKey')
    expect($.neq('inputFocus', true)._tag).toBe('WhenNeq')
  })
})

describe('When builder — match (open-string keys only)', () => {
  test('match on an open-string key produces a WhenMatch', () => {
    const $ = When(manifest)
    const ast = $.match('editorLangId', '^(markdown|prompt)$')
    expect(ast._tag).toBe('WhenMatch')
    expect(encode(ast)).toBe('editorLangId =~ /^(markdown|prompt)$/')
  })

  test('match forwards flags', () => {
    const $ = When(manifest)
    expect(encode($.match('editorLangId', 'foo', 'i'))).toBe('editorLangId =~ /foo/i')
  })
})

describe('When builder — comparisons (numeric keys only)', () => {
  test('lt/lte/gt/gte on a numeric key produce WhenCmp', () => {
    const $ = When(manifest)
    expect(encode($.lt('ext.lineCount', 5))).toBe('ext.lineCount < 5')
    expect(encode($.lte('ext.lineCount', 5))).toBe('ext.lineCount <= 5')
    expect(encode($.gt('ext.lineCount', 5))).toBe('ext.lineCount > 5')
    expect(encode($.gte('ext.lineCount', 5))).toBe('ext.lineCount >= 5')
  })
})

describe('When builder — in (key-to-key)', () => {
  test('in produces a WhenIn over two declared keys', () => {
    const $ = When(manifest)
    const ast = $.in('editorLangId', 'activeCustomEditorId')
    expect(ast._tag).toBe('WhenIn')
    expect(encode(ast)).toBe('editorLangId in activeCustomEditorId')
  })
})
