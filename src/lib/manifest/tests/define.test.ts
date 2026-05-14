import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { CommandDecl, ConfigDecl, ContextKeyDecl } from '../schema.ts'
import { defineManifest, type TypedManifest } from '../define.ts'

describe('defineManifest', () => {
  test('captures the const tuple of decls verbatim', () => {
    const ckBoolean = ContextKeyDecl({
      name: 'ext.ready',
      valueType: Schema.Boolean,
    })
    const ckEditorId = ContextKeyDecl({
      name: 'activeCustomEditorId',
      valueType: Schema.Literal('vscode.markdown.preview.editor'),
    })

    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      contextKeys: [ckBoolean, ckEditorId],
    })

    expect(m._tag).toBe('Manifest')
    expect(m.contextKeys.length).toBe(2)
    expect(m.contextKeys[0].valueType).toBe(Schema.Boolean)
    // The second key's valueType is the literal schema we constructed —
    // identical reference, not a re-created equivalent.
    expect(m.contextKeys[1].valueType).toBe(ckEditorId.valueType)
  })

  test('flows the args/result generics through the manifest tuple', () => {
    const greetCmd = CommandDecl({
      id: 'ext.greet',
      args: Schema.Struct({ name: Schema.String }),
      result: Schema.String,
    })
    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      commands: [greetCmd],
    })
    // Runtime: schemas stored verbatim, addressable by position.
    // Type level: m.commands is readonly [typeof greetCmd] — the typed
    // factory generics survive the manifest array boundary because of
    // `<const M>`. Downstream mapped types can read greetCmd.args /
    // .result without going through codegen.
    expect(m.commands[0]).toBe(greetCmd)
  })

  test('rejects non-Schema field at runtime via AnySchema in decls', () => {
    expect(() =>
      defineManifest({
        name: 'ext',
        publisher: 'jasonkuhrt',
        // @ts-expect-error -- intentionally pass an invalid valueType to verify the runtime guard fires
        contextKeys: [ContextKeyDecl.Struct.make({ name: 'bad', valueType: 42 })],
      }),
    ).toThrow()
  })

  test('TypedManifest result is structurally assignable to Manifest', () => {
    const m = defineManifest({ name: 'ext', publisher: 'jasonkuhrt' })
    // The TypedManifest<M> intersection includes Manifest's runtime
    // tag. Codegen consumers that accept `Manifest` accept this too.
    const widened: { readonly _tag: 'Manifest' } = m
    expect(widened._tag).toBe('Manifest')
  })

  test('config tuple captures the valueSchema generics', () => {
    const cfgEnabled = ConfigDecl({ key: 'ext.enabled', valueSchema: Schema.Boolean })
    const cfgThreshold = ConfigDecl({
      key: 'ext.threshold',
      valueSchema: Schema.Number,
      description: 'Sensitivity threshold',
    })
    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      config: [cfgEnabled, cfgThreshold],
    })
    expect(m.config[0].valueSchema).toBe(Schema.Boolean)
    expect(m.config[1].valueSchema).toBe(Schema.Number)
    expect(m.config[1].description).toBe('Sensitivity threshold')
  })

  test('TypedManifest type alias is exported for downstream consumers', () => {
    // Compile-time only: this ensures `TypedManifest<M>` is publicly
    // usable so key-binder and other consumers can constrain function
    // params to typed manifests.
    const sample: TypedManifest<{ readonly name: 'ext'; readonly publisher: 'p' }> = defineManifest(
      { name: 'ext', publisher: 'p' },
    )
    expect(sample._tag).toBe('Manifest')
  })
})
