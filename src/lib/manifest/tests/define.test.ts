import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { WhenBoolKey } from '../../when/when.ts';
import { defineManifest, type TypedManifest } from '../define.ts';
import {
  CommandDecl,
  ConfigDecl,
  ContextKeyDecl,
  ExternalContextKeyDecl,
  MenuDecl,
} from '../schema.ts';

describe('defineManifest', () => {
  test('captures the const tuple of decls verbatim', () => {
    const ckBoolean = ContextKeyDecl({
      name: 'ext.ready',
      valueType: Schema.Boolean,
    });
    const ckEditorId = ContextKeyDecl({
      name: 'activeCustomEditorId',
      valueType: Schema.Literal('vscode.markdown.preview.editor'),
    });

    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      contextKeys: [ckBoolean, ckEditorId],
    });

    expect(m._tag).toBe('Manifest');
    expect(m.contextKeys.length).toBe(2);
    expect(m.contextKeys[0].valueType).toBe(Schema.Boolean);
    // The second key's valueType is the literal schema we constructed —
    // identical reference, not a re-created equivalent.
    expect(m.contextKeys[1].valueType).toBe(ckEditorId.valueType);
  });

  test('flows the args/result generics through the manifest tuple', () => {
    const greetCmd = CommandDecl({
      id: 'ext.greet',
      args: Schema.Struct({ name: Schema.String }),
      result: Schema.String,
    });
    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      commands: [greetCmd],
    });
    // Runtime: schemas stored verbatim, addressable by position.
    // Type level: m.commands is readonly [typeof greetCmd] — the typed
    // factory generics survive the manifest array boundary because of
    // `<const M>`. Downstream mapped types can read greetCmd.args /
    // .result without going through codegen.
    expect(m.commands[0]).toBe(greetCmd);
  });

  test('rejects non-Schema field at runtime via AnySchema in decls', () => {
    expect(() =>
      defineManifest({
        name: 'ext',
        publisher: 'jasonkuhrt',
        contextKeys: [
          ContextKeyDecl.Struct.make({
            name: 'bad',
            // @ts-expect-error -- exercise the runtime Schema guard with invalid input
            valueType: 42,
          }),
        ],
      }),
    ).toThrow();
  });

  test('a declaration keeps its schema tag when the input has an extra tag', () => {
    const spec = {
      id: 'ext.run',
      args: Schema.Void,
      result: Schema.Void,
      _tag: 'Unrelated',
    };
    expect(CommandDecl(spec)._tag).toBe('CommandDecl');
  });

  test('TypedManifest result is structurally assignable to Manifest', () => {
    const m = defineManifest({ name: 'ext', publisher: 'jasonkuhrt' });
    // The TypedManifest<M> intersection includes Manifest's runtime
    // tag. Codegen consumers that accept `Manifest` accept this too.
    const widened: { readonly _tag: 'Manifest' } = m;
    expect(widened._tag).toBe('Manifest');
  });

  test('config tuple captures the valueSchema generics', () => {
    const cfgEnabled = ConfigDecl({
      key: 'ext.enabled',
      valueSchema: Schema.Boolean,
    });
    const cfgThreshold = ConfigDecl({
      key: 'ext.threshold',
      valueSchema: Schema.Finite,
      description: 'Sensitivity threshold',
    });
    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      config: [cfgEnabled, cfgThreshold],
    });
    expect(m.config[0].valueSchema).toBe(Schema.Boolean);
    expect(m.config[1].valueSchema).toBe(Schema.Finite);
    expect(m.config[1].description).toBe('Sensitivity threshold');
  });

  test('externalContextKeys tuple captures closed-enum value domains', () => {
    const previewKey = ExternalContextKeyDecl({
      name: 'activeCustomEditorId',
      valueType: Schema.Literals([
        'vscode.markdown.preview.editor',
        'vscode.audioPreview',
      ]),
      ownedBy: 'vscode core',
    });
    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      externalContextKeys: [previewKey],
    });
    expect(m.externalContextKeys[0]).toBe(previewKey);
    expect(m.externalContextKeys[0].ownedBy).toBe('vscode core');
    // Type level: m.externalContextKeys[0].valueType narrows to
    // `Schema.Literal<['vscode.markdown.preview.editor', 'vscode.audioPreview']>`
    // — the closed-enum union flows into the manifest tuple for the
    // future `When.eq.activeCustomEditorId(...)` builder.
  });

  test('menus tuple is captured verbatim with its WhenAst', () => {
    const when = WhenBoolKey.make({ key: 'explorerResourceIsFolder' });
    const menu = MenuDecl({
      location: 'explorer/context',
      command: 'ext.delete',
      when,
      group: 'navigation',
    });
    const m = defineManifest({
      name: 'ext',
      publisher: 'jasonkuhrt',
      commands: [
        CommandDecl({
          id: 'ext.delete',
          args: Schema.Void,
          result: Schema.Void,
        }),
      ],
      menus: [menu],
    });
    expect(m.menus[0]).toBe(menu);
    expect(m.menus[0].location).toBe('explorer/context');
    expect(m.menus[0].command).toBe('ext.delete');
    expect(m.menus[0].when).toBe(when);
    expect(m.menus[0].group).toBe('navigation');
  });

  test('TypedManifest type alias is exported for downstream consumers', () => {
    // Compile-time only: this ensures `TypedManifest<M>` is publicly
    // usable so key-binder and other consumers can constrain function
    // params to typed manifests.
    const sample: TypedManifest<{
      readonly name: 'ext';
      readonly publisher: 'p';
    }> = defineManifest({ name: 'ext', publisher: 'p' });
    expect(sample._tag).toBe('Manifest');
  });
});
