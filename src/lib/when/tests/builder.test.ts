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
  contextKeys: [ContextKeyDecl({ name: 'ext.ready', valueType: Schema.Boolean })],
  externalContextKeys: [
    ExternalContextKeyDecl({
      name: 'activeCustomEditorId',
      valueType: Schema.Literal('vscode.markdown.preview.editor'),
    }),
    ExternalContextKeyDecl({ name: 'inputFocus', valueType: Schema.Boolean }),
  ],
})

describe('When builder', () => {
  test('is(key) produces a WhenBoolKey for declared keys', () => {
    const $ = When(manifest)
    const ast = $.is('ext.ready')
    expect(ast._tag).toBe('WhenBoolKey')
    expect(Schema.encodeSync(WhenClause)(ast)).toBe('ext.ready')
  })

  test('eq(key, value) produces a WhenEq for value-domain keys', () => {
    const $ = When(manifest)
    const ast = $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor')
    expect(ast._tag).toBe('WhenEq')
    expect(Schema.encodeSync(WhenClause)(ast)).toBe(
      "activeCustomEditorId == 'vscode.markdown.preview.editor'",
    )
  })

  test('and/or/not combinators compose into nested AST', () => {
    const $ = When(manifest)
    const ast = $.and(
      $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor'),
      $.not($.is('inputFocus')),
    )
    expect(ast._tag).toBe('WhenAnd')
    expect(Schema.encodeSync(WhenClause)(ast)).toBe(
      "(activeCustomEditorId == 'vscode.markdown.preview.editor') && (!(inputFocus))",
    )
  })

  test('or operator binds looser than and', () => {
    const $ = When(manifest)
    const ast = $.or($.and($.is('ext.ready'), $.is('inputFocus')), $.is('inputFocus'))
    expect(ast._tag).toBe('WhenOr')
    const clause = Schema.encodeSync(WhenClause)(ast)
    expect(clause).toBe('((ext.ready) && (inputFocus)) || (inputFocus)')
  })

  test('unsafe.raw is an explicit escape hatch', () => {
    const $ = When(manifest)
    const ast = $.unsafe.raw('some-key-vsv-cannot-type')
    expect(ast._tag).toBe('WhenUnsafeRaw')
    expect(Schema.encodeSync(WhenClause)(ast)).toBe('some-key-vsv-cannot-type')
  })

  test('typo on a context key name is a compile error', () => {
    const $ = When(manifest)
    // @ts-expect-error -- 'ext.redy' is not declared in manifest.contextKeys or externalContextKeys
    $.is('ext.redy')
    // The expect() call is here so the test counts; the @ts-expect-error
    // above is the actual assertion (TS would have failed compilation if
    // the line typed).
    expect(true).toBe(true)
  })

  test('typed key names include both contextKeys and externalContextKeys', () => {
    const $ = When(manifest)
    // All four references must compile; the merged registry includes
    // both owned and external decls.
    expect($.is('ext.ready')._tag).toBe('WhenBoolKey')
    expect($.is('activeCustomEditorId')._tag).toBe('WhenBoolKey')
    expect($.is('inputFocus')._tag).toBe('WhenBoolKey')
    expect($.neq('inputFocus', true)._tag).toBe('WhenNeq')
  })
})
