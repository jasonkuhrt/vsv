import { describe, expect, test } from 'bun:test';
import { Effect, Schema } from 'effect';
import {
  CommandDecl,
  ConfigDecl,
  Manifest,
  MenuDecl,
} from '../../manifest/schema.ts';
import { WhenAnd, WhenBoolKey, WhenNot } from '../../when/when.ts';
import { computeContributesDrift } from '../drift.ts';
import {
  asJsonObject,
  mergeManifestIntoPackageJson,
} from '../sync-package-json.ts';

const sampleManifest = (): Manifest =>
  Manifest.make({
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
    config: [ConfigDecl({ key: 'ext.enabled', valueSchema: Schema.Boolean })],
    menus: [
      MenuDecl({
        location: 'explorer/context',
        command: 'ext.run',
        when: WhenAnd.make({
          terms: [
            WhenBoolKey.make({ key: 'explorerResourceIsFolder' }),
            WhenNot.make({ inner: WhenBoolKey.make({ key: 'inputFocus' }) }),
          ],
        }),
        group: 'navigation',
      }),
    ],
  });

describe('computeContributesDrift', () => {
  test('reports in-sync when package.json is exactly the codegen output', () => {
    const m = sampleManifest();
    // The generated package.json is, by construction, in sync with the manifest.
    const generated = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const result = Effect.runSync(computeContributesDrift(m, generated));
    expect(result.inSync).toBe(true);
    expect(result.driftedKeys).toEqual([]);
  });

  // Mutations replace an entire codegen-owned `contributes` value rather than
  // reaching into a deep field. This both exercises the deep-equality compare
  // and keeps the fixtures free of non-null-asserted indexed access.
  const withContributes = (
    pkg: { [k: string]: unknown },
    edit: (contributes: { [k: string]: unknown }) => void,
  ): { [k: string]: unknown } => {
    const contributes = { ...asJsonObject(pkg['contributes']) };
    edit(contributes);
    return { ...pkg, contributes };
  };

  test('catches a hand-edited contributes.menus when block', () => {
    const m = sampleManifest();
    const generated = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    // A human edits the generated clause string directly in package.json.
    const tampered = withContributes(generated, (c) => {
      c['menus'] = {
        'explorer/context': [
          {
            command: 'ext.run',
            when: 'explorerResourceIsFolder',
            group: 'navigation',
          },
        ],
      };
    });
    const result = Effect.runSync(computeContributesDrift(m, tampered));
    expect(result.inSync).toBe(false);
    expect(result.driftedKeys).toContain('menus');
  });

  test('catches a hand-edited contributes.commands title', () => {
    const m = sampleManifest();
    const generated = Effect.runSync(mergeManifestIntoPackageJson(m, {}));
    const tampered = withContributes(generated, (c) => {
      c['commands'] = [{ command: 'ext.run', title: 'Run It Differently' }];
    });
    const result = Effect.runSync(computeContributesDrift(m, tampered));
    expect(result.inSync).toBe(false);
    expect(result.driftedKeys).toContain('commands');
  });

  test('catches a stale package.json that never re-ran codegen for a new menu', () => {
    const m = sampleManifest();
    // Start from the in-sync baseline, then simulate a package.json that
    // predates the menu being added to the manifest by deleting just the
    // generated `menus` key. commands + configuration stay correct, so only
    // `menus` must register as drift.
    const stale = withContributes(
      Effect.runSync(mergeManifestIntoPackageJson(m, {})),
      (c) => {
        delete c['menus'];
      },
    );
    const result = Effect.runSync(computeContributesDrift(m, stale));
    expect(result.inSync).toBe(false);
    expect(result.driftedKeys).toEqual(['menus']);
  });

  test('ignores drift in un-modeled contributes keys (keybindings — key-binder owned)', () => {
    const m = sampleManifest();
    // A key-binder-owned keybinding is present; it is NOT a vsv codegen-owned
    // key, so it must not register as drift.
    const withKeybindings = withContributes(
      Effect.runSync(mergeManifestIntoPackageJson(m, {})),
      (c) => {
        c['keybindings'] = [{ command: 'ext.run', key: 'ctrl+alt+r' }];
      },
    );
    const result = Effect.runSync(computeContributesDrift(m, withKeybindings));
    expect(result.inSync).toBe(true);
    expect(result.driftedKeys).toEqual([]);
  });

  test('reports multiple drifted keys at once', () => {
    const m = sampleManifest();
    const tampered = withContributes(
      Effect.runSync(mergeManifestIntoPackageJson(m, {})),
      (c) => {
        c['commands'] = [{ command: 'ext.run', title: 'Tampered' }];
        c['configuration'] = {
          type: 'object',
          properties: {
            'ext.enabled': { type: 'boolean', description: 'injected' },
          },
        };
      },
    );
    const result = Effect.runSync(computeContributesDrift(m, tampered));
    expect(result.inSync).toBe(false);
    expect(result.driftedKeys).toContain('commands');
    expect(result.driftedKeys).toContain('configuration');
  });
});
