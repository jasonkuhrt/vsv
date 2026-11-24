import { Effect, Path } from 'effect';
import type { Manifest } from '#lib/manifest/schema';
import {
  mergeManifestIntoPackageJson,
  readPackageJson,
  writePackageJson,
} from './sync-package-json.ts';

export interface CodegenInputs {
  readonly consumerRoot: string;
  readonly manifest: Manifest;
}

export const runCodegen = Effect.fnUntraced(function* ({
  consumerRoot,
  manifest,
}: CodegenInputs) {
  const path = yield* Path.Path;
  const packageJsonPath = path.join(consumerRoot, 'package.json');
  const existing = yield* readPackageJson(packageJsonPath);
  const merged = yield* mergeManifestIntoPackageJson(manifest, existing);
  yield* writePackageJson(packageJsonPath, merged);
  return { packageJsonPath };
});
