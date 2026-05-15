// Type-level tests for the manifest-derived registry extractors.
//
// Run by `vitest --typecheck` (see vitest.config.ts) — `check:types-d`.
// These assert the EXACT type each extractor derives from a manifest. The
// `.not.toBeAny()` guard is load-bearing: a mapped type that fails to infer
// silently falls back to `Schema.Schema.AnyNoContext`, whose decoded type is
// `any` — and `any` satisfies most exact-equality checks. Without the
// any-guard a broken extractor can pass `toEqualTypeOf`.

import { Schema } from 'effect'
import { describe, expectTypeOf, test } from 'vitest'
import { CommandDecl } from '#lib/manifest/decls/command'
import { ConfigDecl } from '#lib/manifest/decls/config'
import { ContextKeyDecl } from '#lib/manifest/decls/context-key'
import { ExternalCommandDecl } from '#lib/manifest/decls/external-command'
import { ExternalContextKeyDecl } from '#lib/manifest/decls/external-context-key'
import { ForeignConfigDecl } from '#lib/manifest/decls/foreign-config'
import { StateDecl } from '#lib/manifest/decls/state'
import { defineManifest } from '#lib/manifest/define'
import type {
  CommandArgs,
  CommandEntry,
  CommandRegistryOf,
  CommandResult,
  ConfigRegistryOf,
  ConfigValue,
  ContextKeyRegistryOf,
  ContextKeyValue,
  EventRegistryOf,
  ExternalCommandArgs,
  ExternalCommandRegistryOf,
  ExternalCommandResult,
  ForeignConfigRegistryOf,
  ForeignConfigValue,
  StateEntry,
  StateRegistryOf,
  StateScope,
  StateValue,
} from '#lib/runtime/registries'

// One manifest exercising every decl slot. Names/keys are distinct literals
// so each extractor has an unambiguous expected output.
const m = defineManifest({
  name: 'tm',
  publisher: 'p',
  commands: [
    CommandDecl({
      id: 'cmd.greet',
      args: Schema.Struct({ name: Schema.String }),
      result: Schema.String,
    }),
    CommandDecl({ id: 'cmd.noop', args: Schema.Void, result: Schema.Void }),
  ],
  externalCommands: [
    ExternalCommandDecl({ id: 'ext.move', args: Schema.Tuple(Schema.String), result: Schema.Void }),
    ExternalCommandDecl({
      id: 'ext.rename',
      args: Schema.Tuple(Schema.String, Schema.Number),
      result: Schema.Boolean,
    }),
  ],
  contextKeys: [
    ContextKeyDecl({ name: 'ck.bool', valueType: Schema.Boolean }),
    ContextKeyDecl({ name: 'ck.enum', valueType: Schema.Literal('a', 'b') }),
    ContextKeyDecl({ name: 'ck.single', valueType: Schema.Literal('only') }),
    ContextKeyDecl({ name: 'ck.num', valueType: Schema.Number }),
  ],
  externalContextKeys: [
    ExternalContextKeyDecl({ name: 'eck.str', valueType: Schema.String }),
    // Same name, two decls — `ContextKeyValue` must merge to the union.
    ExternalContextKeyDecl({ name: 'eck.merged', valueType: Schema.Literal('x') }),
    ExternalContextKeyDecl({ name: 'eck.merged', valueType: Schema.Literal('y') }),
  ],
  config: [ConfigDecl({ key: 'cfg.enabled', valueSchema: Schema.Boolean })],
  foreignConfig: [ForeignConfigDecl({ fullKey: 'editor.fontSize', valueSchema: Schema.Number })],
  state: [
    StateDecl({ key: 'st.count', scope: 'global', valueSchema: Schema.Number }),
    StateDecl({ key: 'st.draft', scope: 'workspace', valueSchema: Schema.String }),
  ],
})

type M = typeof m

// ─── Fixture canary ──────────────────────────────────────────────────────
// If `<const M>` capture regresses, the fixture's decl arrays widen to
// `ReadonlyArray` and every extractor below would resolve against widened
// types — passing vacuously. This asserts the fixture itself is sound.

describe('fixture', () => {
  test('decl arrays are captured as fixed-length tuples', () => {
    expectTypeOf<M['commands']['length']>().toEqualTypeOf<2>()
    expectTypeOf<M['contextKeys']['length']>().toEqualTypeOf<4>()
    expectTypeOf<M['state']['length']>().toEqualTypeOf<2>()
  })
})

// ─── CommandRegistryOf ───────────────────────────────────────────────────

describe('CommandRegistryOf', () => {
  test('keys are the declared command ids', () => {
    expectTypeOf<keyof CommandRegistryOf<M>>().toEqualTypeOf<'cmd.greet' | 'cmd.noop'>()
  })

  test('entry pairs decoded args + result', () => {
    expectTypeOf<CommandRegistryOf<M>['cmd.greet']>().toEqualTypeOf<
      CommandEntry<{ readonly name: string }, string>
    >()
    expectTypeOf<CommandRegistryOf<M>['cmd.noop']>().toEqualTypeOf<CommandEntry<void, void>>()
  })

  test('entry args are not any', () => {
    expectTypeOf<CommandRegistryOf<M>['cmd.greet']['args']>().not.toBeAny()
  })
})

// ─── ExternalCommandRegistryOf ───────────────────────────────────────────

describe('ExternalCommandRegistryOf', () => {
  test('keys are the declared external command ids', () => {
    expectTypeOf<keyof ExternalCommandRegistryOf<M>>().toEqualTypeOf<'ext.move' | 'ext.rename'>()
  })

  test('entry pairs decoded args + result', () => {
    expectTypeOf<ExternalCommandRegistryOf<M>['ext.move']>().toEqualTypeOf<
      CommandEntry<readonly [string], void>
    >()
    expectTypeOf<ExternalCommandRegistryOf<M>['ext.rename']>().toEqualTypeOf<
      CommandEntry<readonly [string, number], boolean>
    >()
  })
})

// ─── ContextKeyRegistryOf ────────────────────────────────────────────────

describe('ContextKeyRegistryOf', () => {
  test('keys merge owned + external context-key names', () => {
    expectTypeOf<keyof ContextKeyRegistryOf<M>>().toEqualTypeOf<
      'ck.bool' | 'ck.enum' | 'ck.single' | 'ck.num' | 'eck.str' | 'eck.merged'
    >()
  })

  test('entry is the decoded value type — not any', () => {
    expectTypeOf<ContextKeyRegistryOf<M>['ck.bool']>().not.toBeAny()
    expectTypeOf<ContextKeyRegistryOf<M>['ck.bool']>().toEqualTypeOf<boolean>()
    expectTypeOf<ContextKeyRegistryOf<M>['ck.enum']>().toEqualTypeOf<'a' | 'b'>()
    expectTypeOf<ContextKeyRegistryOf<M>['eck.str']>().toEqualTypeOf<string>()
  })

  test('same-named decls merge into the value union', () => {
    expectTypeOf<ContextKeyRegistryOf<M>['eck.merged']>().toEqualTypeOf<'x' | 'y'>()
  })

  test('an undeclared key is not in the registry', () => {
    // @ts-expect-error -- 'ck.undeclared' was never declared in the manifest
    type _Absent = ContextKeyRegistryOf<M>['ck.undeclared']
  })
})

// ─── ConfigRegistryOf / ForeignConfigRegistryOf ──────────────────────────

describe('ConfigRegistryOf', () => {
  test('key → decoded value type', () => {
    expectTypeOf<keyof ConfigRegistryOf<M>>().toEqualTypeOf<'cfg.enabled'>()
    expectTypeOf<ConfigRegistryOf<M>['cfg.enabled']>().not.toBeAny()
    expectTypeOf<ConfigRegistryOf<M>['cfg.enabled']>().toEqualTypeOf<boolean>()
  })
})

describe('ForeignConfigRegistryOf', () => {
  test('fullKey → decoded value type', () => {
    expectTypeOf<keyof ForeignConfigRegistryOf<M>>().toEqualTypeOf<'editor.fontSize'>()
    expectTypeOf<ForeignConfigRegistryOf<M>['editor.fontSize']>().not.toBeAny()
    expectTypeOf<ForeignConfigRegistryOf<M>['editor.fontSize']>().toEqualTypeOf<number>()
  })
})

// ─── StateRegistryOf ─────────────────────────────────────────────────────

describe('StateRegistryOf', () => {
  test('key → value + scope entry', () => {
    expectTypeOf<keyof StateRegistryOf<M>>().toEqualTypeOf<'st.count' | 'st.draft'>()
    expectTypeOf<StateRegistryOf<M>['st.count']>().toEqualTypeOf<StateEntry<number, 'global'>>()
    expectTypeOf<StateRegistryOf<M>['st.draft']>().toEqualTypeOf<StateEntry<string, 'workspace'>>()
  })

  test('entry value is not any', () => {
    expectTypeOf<StateRegistryOf<M>['st.count']['value']>().not.toBeAny()
  })
})

// ─── EventRegistryOf ─────────────────────────────────────────────────────

describe('EventRegistryOf', () => {
  test('is the permissive placeholder until EventDecl lands', () => {
    expectTypeOf<EventRegistryOf<M>>().toEqualTypeOf<Record<string, unknown>>()
  })
})

// ─── CommandArgs / CommandResult ─────────────────────────────────────────

describe('CommandArgs', () => {
  test('extracts decoded args for a command id', () => {
    expectTypeOf<CommandArgs<M, 'cmd.greet'>>().not.toBeAny()
    expectTypeOf<CommandArgs<M, 'cmd.greet'>>().toEqualTypeOf<{ readonly name: string }>()
    expectTypeOf<CommandArgs<M, 'cmd.noop'>>().toEqualTypeOf<void>()
  })
})

describe('CommandResult', () => {
  test('extracts decoded result for a command id', () => {
    expectTypeOf<CommandResult<M, 'cmd.greet'>>().not.toBeAny()
    expectTypeOf<CommandResult<M, 'cmd.greet'>>().toEqualTypeOf<string>()
    expectTypeOf<CommandResult<M, 'cmd.noop'>>().toEqualTypeOf<void>()
  })
})

// ─── ExternalCommandArgs / ExternalCommandResult ─────────────────────────

describe('ExternalCommandArgs', () => {
  test('extracts decoded args for an external command id', () => {
    expectTypeOf<ExternalCommandArgs<M, 'ext.move'>>().not.toBeAny()
    expectTypeOf<ExternalCommandArgs<M, 'ext.move'>>().toEqualTypeOf<readonly [string]>()
    expectTypeOf<ExternalCommandArgs<M, 'ext.rename'>>().toEqualTypeOf<readonly [string, number]>()
  })
})

describe('ExternalCommandResult', () => {
  test('extracts decoded result for an external command id', () => {
    expectTypeOf<ExternalCommandResult<M, 'ext.move'>>().not.toBeAny()
    expectTypeOf<ExternalCommandResult<M, 'ext.move'>>().toEqualTypeOf<void>()
    expectTypeOf<ExternalCommandResult<M, 'ext.rename'>>().toEqualTypeOf<boolean>()
  })
})

// ─── StateValue / StateScope ─────────────────────────────────────────────

describe('StateValue', () => {
  test('extracts decoded value for a state key', () => {
    expectTypeOf<StateValue<M, 'st.count'>>().not.toBeAny()
    expectTypeOf<StateValue<M, 'st.count'>>().toEqualTypeOf<number>()
    expectTypeOf<StateValue<M, 'st.draft'>>().toEqualTypeOf<string>()
  })
})

describe('StateScope', () => {
  test('extracts the declared scope literal for a state key', () => {
    expectTypeOf<StateScope<M, 'st.count'>>().toEqualTypeOf<'global'>()
    expectTypeOf<StateScope<M, 'st.draft'>>().toEqualTypeOf<'workspace'>()
  })
})

// ─── ContextKeyValue ─────────────────────────────────────────────────────

describe('ContextKeyValue', () => {
  // The five value-domain shapes the codec must keep narrow. Each gets a
  // `.not.toBeAny()` — the guard whose absence let the original bug ship.
  test('boolean', () => {
    expectTypeOf<ContextKeyValue<M, 'ck.bool'>>().not.toBeAny()
    expectTypeOf<ContextKeyValue<M, 'ck.bool'>>().toEqualTypeOf<boolean>()
  })

  test('single string literal', () => {
    expectTypeOf<ContextKeyValue<M, 'ck.single'>>().not.toBeAny()
    expectTypeOf<ContextKeyValue<M, 'ck.single'>>().toEqualTypeOf<'only'>()
  })

  test('string-literal union', () => {
    expectTypeOf<ContextKeyValue<M, 'ck.enum'>>().not.toBeAny()
    expectTypeOf<ContextKeyValue<M, 'ck.enum'>>().toEqualTypeOf<'a' | 'b'>()
  })

  test('open string', () => {
    expectTypeOf<ContextKeyValue<M, 'eck.str'>>().not.toBeAny()
    expectTypeOf<ContextKeyValue<M, 'eck.str'>>().toEqualTypeOf<string>()
  })

  test('number', () => {
    expectTypeOf<ContextKeyValue<M, 'ck.num'>>().not.toBeAny()
    expectTypeOf<ContextKeyValue<M, 'ck.num'>>().toEqualTypeOf<number>()
  })

  test('merges same-named decls into the value union', () => {
    expectTypeOf<ContextKeyValue<M, 'eck.merged'>>().not.toBeAny()
    expectTypeOf<ContextKeyValue<M, 'eck.merged'>>().toEqualTypeOf<'x' | 'y'>()
  })
})

// ─── ConfigValue / ForeignConfigValue ────────────────────────────────────

describe('ConfigValue', () => {
  test('extracts decoded value for an owned config key', () => {
    expectTypeOf<ConfigValue<M, 'cfg.enabled'>>().not.toBeAny()
    expectTypeOf<ConfigValue<M, 'cfg.enabled'>>().toEqualTypeOf<boolean>()
  })
})

describe('ForeignConfigValue', () => {
  test('extracts decoded value for a foreign config key', () => {
    expectTypeOf<ForeignConfigValue<M, 'editor.fontSize'>>().not.toBeAny()
    expectTypeOf<ForeignConfigValue<M, 'editor.fontSize'>>().toEqualTypeOf<number>()
  })
})
