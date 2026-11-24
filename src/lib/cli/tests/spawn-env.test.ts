import { describe, expect, test } from 'bun:test';
import { ConfigProvider, Effect, Layer, Path } from 'effect';
import { buildSpawnEnv } from '../spawn-env.ts';

const layer = Layer.merge(
  Path.layer,
  ConfigProvider.layer(ConfigProvider.fromUnknown({ PATH: '/usr/bin:/bin' })),
);

describe('buildSpawnEnv', () => {
  test('prepends the project and ancestor tool paths in resolution order', () => {
    const env = Effect.runSync(Effect.provide(buildSpawnEnv('/a/b'), layer));
    expect(env.PATH).toBe(
      '/a/b/node_modules/.bin:/a/node_modules/.bin:/node_modules/.bin:/usr/bin:/bin',
    );
  });
});
