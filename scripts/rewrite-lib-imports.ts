/**
 * @description Post-build: rewrite the package-internal `#lib/*` import
 * specifier to a relative path inside `build/`, so the compiled artifacts are
 * self-contained.
 *
 * ## Why this exists
 *
 * `package.json#imports` maps `"#lib/*": "./src/lib/*.ts"`. That mapping is
 * what lets source (`src`) and `bun test` resolve internal modules without
 * relative path soup. But the bare `#lib/...` specifier survives `tsrs` emit
 * into the compiled `build/**` artifacts (tsrs does not rewrite
 * subpath-imports). A downstream consumer of the _compiled_ `/manifest` or
 * `/when` therefore resolves `#lib/...` back through the package's own
 * `imports` map to raw `./src/lib/*.ts` — pulling un-built TypeScript into a
 * plain-JS consumer.
 *
 * This step makes `build/**` self-contained: every `#lib/X` becomes a relative
 * path from the emitting file to `build/lib/X`, with the extension that file
 * type already uses for its other relative imports:
 *
 * - `.js` files → `#lib/X` → `./relative/X.js` (rewriteRelativeImportExtensions
 *   emit)
 * - `.d.ts` files → `#lib/X` → `./relative/X.ts` (TS declaration convention here)
 *
 * `package.json#imports` is left pointing at `src` so source-level testing
 * (`bun test src tests`) and `tsrs` typechecking keep resolving against `.ts`.
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Path, Schema, String } from 'effect';

const libSpecifier = /(['"])#lib\/([^'"]+)\1/g;

class MissingBuild extends Schema.TaggedError<MissingBuild, {}>()(
  'MissingBuild',
  {
    path: Schema.String,
  },
) {}

const rewrite = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const build = path.resolve(import.meta.dirname, '..', 'build');
  if (!(yield* fs.exists(build)))
    return yield* MissingBuild.make({ path: build });

  const files = yield* fs.glob('**/*.js', { root: build });
  const declarations = yield* fs.glob('**/*.d.ts', { root: build });
  let rewritten = 0;
  for (const file of [...files, ...declarations]) {
    const filePath = path.join(build, file);
    const extension = String.endsWith('.d.ts')(file) ? '.ts' : '.js';
    const source = yield* fs.readFileString(filePath);
    let next = '';
    let offset = 0;
    for (const match of String.matchAll(libSpecifier)(source)) {
      const [specifier, quote, tail] = match;
      if (
        match.index === undefined ||
        quote === undefined ||
        tail === undefined
      )
        continue;
      const target = path.join(build, 'lib', `${tail}${extension}`);
      const relative = String.replaceAll(
        path.sep,
        '/',
      )(path.relative(path.dirname(filePath), target));
      const importPath = String.startsWith('.')(relative)
        ? relative
        : `./${relative}`;
      next +=
        String.slice(offset, match.index)(source) +
        `${quote}${importPath}${quote}`;
      offset = match.index + specifier.length;
    }
    if (offset === 0) continue;
    yield* fs.writeFileString(filePath, next + String.slice(offset)(source));
    rewritten++;
  }
  yield* Effect.logInfo(
    `rewrite-lib-imports: rewrote #lib/* specifiers in ${globalThis.String(rewritten)} file(s)`,
  );
});

BunRuntime.runMain(Effect.provide(rewrite, BunServices.layer));
