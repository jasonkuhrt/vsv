import { Array, Effect, FileSystem, Path } from 'effect';
import { computeContributesDrift } from '#lib/codegen/drift';
import { readPackageJson } from '#lib/codegen/sync-package-json';
import { loadManifest } from '../load-manifest.ts';
import { stderr, stdout } from '../output.ts';

export interface DriftOptions {
  readonly consumerRoot?: string;
}

export const drift = Effect.fnUntraced(function* (options: DriftOptions = {}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const consumerRoot = path.resolve(options.consumerRoot ?? '.');
  const manifestPath = path.join(consumerRoot, 'vsv.manifest.ts');
  const exists = yield* fs.exists(manifestPath);
  if (!exists) {
    yield* stdout(
      'vsv check: no vsv.manifest.ts — skipping contributes drift check\n',
    );
    return 0;
  }

  const manifest = yield* loadManifest(manifestPath);
  const packageJsonPath = path.join(consumerRoot, 'package.json');
  const packageJson = yield* readPackageJson(packageJsonPath);
  const result = yield* computeContributesDrift(manifest, packageJson);
  if (result.inSync) {
    yield* stdout(
      'vsv check: package.json contributes in sync with manifest\n',
    );
    return 0;
  }

  yield* stderr(
    'vsv check: package.json#contributes is out of sync with the manifest.\n' +
      `  Drifted keys: ${Array.join(result.driftedKeys, ', ')}\n` +
      `  Run \`vsv dev --once\` to regenerate ${packageJsonPath}.\n`,
  );
  return 1;
});
