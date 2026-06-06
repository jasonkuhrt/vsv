// Type-level tests for the manifest-bound `Menu(manifest)` builder. The
// builder's `entry({ command })` must narrow `command` to the manifest's
// declared command-id universe (owned `commands` + consumed
// `externalCommands`), so an undeclared id is a compile error — symmetric to
// `When(manifest)`'s context-key narrowing.

import { Schema } from 'effect'
import { describe, expectTypeOf, test } from 'vitest'
import { CommandDecl } from '#lib/manifest/decls/command'
import { ExternalCommandDecl } from '#lib/manifest/decls/external-command'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { type CommandId, Menu } from '#lib/manifest/menu-builder'
import { defineManifest } from '#lib/manifest/define'
import { When } from '#lib/when/builder'

const manifest = defineManifest({
  name: 'ext',
  publisher: 'jasonkuhrt',
  commands: [CommandDecl({ id: 'ext.delete', args: Schema.Void, result: Schema.Void })],
  externalCommands: [
    ExternalCommandDecl({
      id: 'workbench.action.files.save',
      args: Schema.Void,
      result: Schema.Void,
    }),
  ],
  externalContextKeys: [
    ExternalContextKeyDecl({ name: 'explorerResourceIsFolder', valueType: Schema.Boolean }),
  ],
})

describe('CommandId<M>', () => {
  test('unions owned + external command ids', () => {
    expectTypeOf<CommandId<typeof manifest>>().toEqualTypeOf<
      'ext.delete' | 'workbench.action.files.save'
    >()
  })
})

describe('Menu(manifest).entry', () => {
  test('accepts a declared owned command id and captures location literal', () => {
    const menu = Menu(manifest)
    const d = menu.entry({ location: 'explorer/context', command: 'ext.delete' })
    expectTypeOf(d.location).toEqualTypeOf<'explorer/context'>()
    expectTypeOf(d.command).toEqualTypeOf<'ext.delete'>()
  })

  test('accepts a declared external command id', () => {
    const menu = Menu(manifest)
    const d = menu.entry({ location: 'editor/title', command: 'workbench.action.files.save' })
    expectTypeOf(d.command).toEqualTypeOf<'workbench.action.files.save'>()
  })

  test('composes with a When(manifest) clause', () => {
    const $ = When(manifest)
    const menu = Menu(manifest)
    const d = menu.entry({
      location: 'explorer/context',
      command: 'ext.delete',
      when: $.is('explorerResourceIsFolder'),
      group: 'navigation',
    })
    expectTypeOf(d.command).toEqualTypeOf<'ext.delete'>()
  })

  test('rejects an undeclared command id', () => {
    const menu = Menu(manifest)
    // @ts-expect-error -- 'ext.nope' is not a declared command id
    menu.entry({ location: 'explorer/context', command: 'ext.nope' })
  })
})
