import { Effect, Path, Predicate, Schema } from 'effect';
import { Manifest } from '#lib/manifest/schema';

export class ManifestImportError extends Schema.TaggedError<
  ManifestImportError,
  {}
>()('ManifestImportError', { path: Schema.String, cause: Schema.Defect() }) {}

export const loadManifest = Effect.fnUntraced(function* (manifestPath: string) {
  const path = yield* Path.Path;
  const url = yield* path.toFileUrl(manifestPath);
  const module: unknown = yield* Effect.tryPromise({
    try: () => import(url.href),
    catch: (cause) => ManifestImportError.make({ path: manifestPath, cause }),
  });
  const spec = Predicate.hasProperty(module, 'default')
    ? module.default
    : undefined;
  return yield* Schema.decodeUnknownEffect(Manifest)(spec);
});
