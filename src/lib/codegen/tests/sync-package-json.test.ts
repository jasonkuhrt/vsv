import { describe, expect, test } from 'bun:test';
import { Record, Effect, Schema } from 'effect';
import {
  CommandDecl,
  ConfigDecl,
  ForeignConfigDecl,
  Manifest,
  MenuDecl,
} from '../../manifest/schema.ts';
import { WhenAnd, WhenBoolKey, WhenNot } from '../../when/when.ts';
import {
  asJsonObject,
  mergeManifestIntoPackageJson,
} from '../sync-package-json.ts';

describe('mergeManifestIntoPackageJson', () => {
  test('preserves unrelated fields (scripts, dependencies)', () => {
    const m = Manifest.make({ name: 'ext', publisher: 'jasonkuhrt' });
    const existing = {
      name: 'old-name',
      scripts: { test: 'bun test' },
      dependencies: { effect: '^3.0.0' },
    };
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, existing));
    expect(merged['name']).toBe('ext');
    expect(merged['scripts']).toEqual({ test: 'bun test' });
    expect(merged['dependencies']).toEqual({ effect: '^3.0.0' });
  });

  test('updates engines.vscode without clobbering other engines', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      engineVscode: '^1.90.0',
    });
    const existing = { engines: { node: '>=18', vscode: '^1.80.0' } };
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, existing));
    expect(merged['engines']).toEqual({ node: '>=18', vscode: '^1.90.0' });
  });

  test('emits contributes.commands from manifest.commands', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      commands: [
        CommandDecl({
          id: 'ext.foo',
          args: Schema.String,
          result: Schema.Void,
          title: 'Foo',
          category: 'Ext',
        }),
      ],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    expect(contributes?.['commands']).toEqual([
      { command: 'ext.foo', title: 'Foo', category: 'Ext' },
    ]);
  });

  test('emits contributes.configuration as JSON Schema', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      config: [
        ConfigDecl({
          key: 'ext.enabled',
          valueSchema: Schema.Boolean,
          description: 'Toggle the extension',
        }),
      ],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    const configuration = asJsonObject(contributes?.['configuration']);
    const properties = asJsonObject(configuration?.['properties']);
    expect(properties?.['ext.enabled']).toMatchObject({
      type: 'boolean',
      description: 'Toggle the extension',
    });
  });

  test('foreignConfig is NOT synced into contributes.configuration', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      foreignConfig: [
        ForeignConfigDecl({
          fullKey: 'editor.codeLens',
          valueSchema: Schema.Boolean,
        }),
      ],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    // The package.json sync must skip foreign keys — re-contributing
    // `editor.codeLens` would corrupt VSCode's settings UI ownership.
    expect(contributes?.['configuration']).toBeUndefined();
  });

  test('foreignConfig and config coexist — only config syncs', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      config: [ConfigDecl({ key: 'ext.enabled', valueSchema: Schema.Boolean })],
      foreignConfig: [
        ForeignConfigDecl({
          fullKey: 'editor.codeLens',
          valueSchema: Schema.Boolean,
        }),
      ],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    const configuration = asJsonObject(contributes?.['configuration']);
    const properties = asJsonObject(configuration?.['properties']);
    expect(Record.keys(properties ?? {})).toEqual(['ext.enabled']);
  });

  test('manifest name wins over existing package.json name', () => {
    const m = Manifest.make({ name: 'new-name', publisher: 'jasonkuhrt' });
    const existing = { name: 'old-name' };
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, existing));
    expect(merged['name']).toBe('new-name');
  });

  test('does not touch main/exports/bin', () => {
    const m = Manifest.make({ name: 'ext', publisher: 'jasonkuhrt' });
    const existing = {
      main: './out/extension.js',
      bin: { ext: './bin/cli.js' },
      exports: { '.': './out/index.js' },
    };
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, existing));
    expect(merged['main']).toBe('./out/extension.js');
    expect(merged['bin']).toEqual({ ext: './bin/cli.js' });
    expect(merged['exports']).toEqual({ '.': './out/index.js' });
  });

  test('emits contributes.menus from manifest.menus, encoding the WhenAst', () => {
    // when = explorerResourceIsFolder && !inputFocus
    const when = WhenAnd.make({
      terms: [
        WhenBoolKey.make({ key: 'explorerResourceIsFolder' }),
        WhenNot.make({ inner: WhenBoolKey.make({ key: 'inputFocus' }) }),
      ],
    });
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      menus: [
        MenuDecl({
          location: 'explorer/context',
          command: 'ext.deleteFolder',
          when,
          group: 'navigation',
        }),
      ],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    expect(contributes?.['menus']).toEqual({
      'explorer/context': [
        {
          command: 'ext.deleteFolder',
          // The WhenAst is serialized to VS Code's canonical clause syntax —
          // minimal, precedence-aware parens (atoms and bare-key negations
          // need none), the idiomatic form VS Code itself emits.
          when: 'explorerResourceIsFolder && !inputFocus',
          group: 'navigation',
        },
      ],
    });
  });

  test('omits when/group when a MenuDecl declares neither', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      menus: [MenuDecl({ location: 'commandPalette', command: 'ext.run' })],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    expect(contributes?.['menus']).toEqual({
      commandPalette: [{ command: 'ext.run' }],
    });
  });

  test('groups multiple MenuDecls by location, preserving declared order', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      menus: [
        MenuDecl({ location: 'editor/title', command: 'ext.first' }),
        MenuDecl({ location: 'explorer/context', command: 'ext.folder' }),
        MenuDecl({ location: 'editor/title', command: 'ext.second' }),
      ],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    expect(contributes?.['menus']).toEqual({
      'editor/title': [{ command: 'ext.first' }, { command: 'ext.second' }],
      'explorer/context': [{ command: 'ext.folder' }],
    });
  });

  test('coexists with commands/configuration and spread-preserves un-modeled contributes keys', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      commands: [
        CommandDecl({
          id: 'ext.run',
          args: Schema.Void,
          result: Schema.Void,
          title: 'Run',
        }),
      ],
      menus: [MenuDecl({ location: 'commandPalette', command: 'ext.run' })],
    });
    // key-binder owns keybindings (spec §0) — codegen must not clobber them.
    const existing = {
      contributes: { keybindings: [{ command: 'ext.run', key: 'ctrl+r' }] },
    };
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, existing));
    const contributes = asJsonObject(merged['contributes']);
    expect(contributes?.['commands']).toEqual([
      { command: 'ext.run', title: 'Run' },
    ]);
    expect(contributes?.['menus']).toEqual({
      commandPalette: [{ command: 'ext.run' }],
    });
    expect(contributes?.['keybindings']).toEqual([
      { command: 'ext.run', key: 'ctrl+r' },
    ]);
  });

  test('no menus key emitted when manifest.menus is empty/absent', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      menus: [],
    });
    const merged = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const contributes = asJsonObject(merged['contributes']);
    expect(contributes?.['menus']).toBeUndefined();
  });
});
