import { Schema } from 'effect'
import { describe, expect, test } from 'bun:test'
import { CommandDecl, ConfigDecl, Manifest } from '../../manifest/schema.ts'
import { mergeManifestIntoPackageJson } from '../sync-package-json.ts'

describe('mergeManifestIntoPackageJson', () => {
  test('preserves unrelated fields (scripts, dependencies)', () => {
    const m = Manifest.make({ name: 'ext', publisher: 'jasonkuhrt' })
    const existing = {
      name: 'old-name',
      scripts: { test: 'bun test' },
      dependencies: { effect: '^3.0.0' },
    }
    const merged = mergeManifestIntoPackageJson(m, existing)
    expect(merged['name']).toBe('ext')
    expect(merged['scripts']).toEqual({ test: 'bun test' })
    expect(merged['dependencies']).toEqual({ effect: '^3.0.0' })
  })

  test('updates engines.vscode without clobbering other engines', () => {
    const m = Manifest.make({ name: 'ext', publisher: 'jasonkuhrt', engineVscode: '^1.90.0' })
    const existing = { engines: { node: '>=18', vscode: '^1.80.0' } }
    const merged = mergeManifestIntoPackageJson(m, existing)
    expect(merged['engines']).toEqual({ node: '>=18', vscode: '^1.90.0' })
  })

  test('emits contributes.commands from manifest.commands', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      commands: [
        CommandDecl.make({
          id: 'ext.foo',
          args: Schema.String,
          result: Schema.Void,
          title: 'Foo',
          category: 'Ext',
        }),
      ],
    })
    const merged = mergeManifestIntoPackageJson(m, {})
    const contributes = merged['contributes'] as { commands: Array<Record<string, unknown>> }
    expect(contributes.commands).toEqual([{ command: 'ext.foo', title: 'Foo', category: 'Ext' }])
  })

  test('emits contributes.configuration as JSON Schema', () => {
    const m = Manifest.make({
      name: 'ext',
      publisher: 'jasonkuhrt',
      config: [
        ConfigDecl.make({
          key: 'ext.enabled',
          valueSchema: Schema.Boolean,
          description: 'Toggle the extension',
        }),
      ],
    })
    const merged = mergeManifestIntoPackageJson(m, {})
    const contributes = merged['contributes'] as {
      configuration: { properties: Record<string, { type?: string; description?: string }> }
    }
    expect(contributes.configuration.properties['ext.enabled']).toMatchObject({
      type: 'boolean',
      description: 'Toggle the extension',
    })
  })

  test('manifest name wins over existing package.json name', () => {
    const m = Manifest.make({ name: 'new-name', publisher: 'jasonkuhrt' })
    const existing = { name: 'old-name' }
    const merged = mergeManifestIntoPackageJson(m, existing)
    expect(merged['name']).toBe('new-name')
  })

  test('does not touch main/exports/bin', () => {
    const m = Manifest.make({ name: 'ext', publisher: 'jasonkuhrt' })
    const existing = {
      main: './out/extension.js',
      bin: { ext: './bin/cli.js' },
      exports: { '.': './out/index.js' },
    }
    const merged = mergeManifestIntoPackageJson(m, existing)
    expect(merged['main']).toBe('./out/extension.js')
    expect(merged['bin']).toEqual({ ext: './bin/cli.js' })
    expect(merged['exports']).toEqual({ '.': './out/index.js' })
  })
})
