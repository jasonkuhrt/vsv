import { Effect, FileSystem, Path, Stream } from 'effect';
import { runCodegen } from '#lib/codegen/engine';
import { generateBootstrap } from '#lib/loader-hook/bootstrap-generator';
import { loadManifest } from '../load-manifest.ts';
import { stderr, stdout } from '../output.ts';
import { spawnTool } from '../spawn-env.ts';

const runOnce = Effect.fnUntraced(function* (
  consumerRoot: string,
  manifestPath: string,
) {
  const manifest = yield* loadManifest(manifestPath);
  const { packageJsonPath } = yield* runCodegen({ consumerRoot, manifest });
  yield* stdout(`updated ${packageJsonPath}\n`);
  const { bootstrapPath, warnings } = yield* generateBootstrap({
    consumerRoot,
  });
  yield* stdout(`wrote ${bootstrapPath}\n`);
  for (const warning of warnings) yield* stdout(`warning: ${warning}\n`);
});

export interface DevOptions {
  readonly entrypoint: string;
  readonly once?: boolean;
  readonly consumerRoot?: string;
}

export const dev = Effect.fnUntraced(function* (options: DevOptions) {
  const path = yield* Path.Path;
  const consumerRoot = path.resolve(options.consumerRoot ?? '.');
  const manifestPath = path.join(consumerRoot, 'vsv.manifest.ts');

  if (options.once === true) return yield* runOnce(consumerRoot, manifestPath);

  const fs = yield* FileSystem.FileSystem;
  yield* stdout(`vsv dev: watching ${manifestPath}\n`);
  yield* runOnce(consumerRoot, manifestPath);
  const changes = fs
    .watch(consumerRoot)
    .pipe(
      Stream.filter(
        (event) =>
          event._tag !== 'Remove' &&
          path.resolve(consumerRoot, event.path) === manifestPath,
      ),
    );
  // A fresh process evaluates the manifest and its imports after each save.
  const regenerate = spawnTool(
    'bun',
    [options.entrypoint, 'dev', '--once'],
    consumerRoot,
  ).pipe(
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : stderr(`vsv dev: generation exited with code ${String(code)}\n`),
    ),
    Effect.catch((error) => stderr(`vsv dev: ${error.message}\n`)),
  );
  yield* Stream.runForEach(changes, () => regenerate);
});
