/**
 * @description Purity guard for vsv's pure library subset.
 *
 * The pure subset (`/manifest`, `/when`, and the future `/builtins`) must be
 * consumable as self-contained JS whose only runtime dependency is `effect`.
 * That holds only while the _shipping_ modules under the pure subtrees import
 * nothing impure. This guard fails CI the moment an impure import sneaks in.
 *
 * ## Scope
 *
 * Scans the shipping modules under:
 *
 * - src/lib/manifest/**
 * - src/lib/when/**
 * - src/lib/schema/**
 * - src/lib/builtins/** (future — Phase B; tolerated-absent today)
 *
 * Test files (`*.test.ts`, `*.test-d.ts`) are excluded: they are NOT part of
 * the consumable surface (excluded from `build` via tsconfig.build.json) and
 * legitimately import `bun:test`. The guard protects what ships, not the
 * tests.
 *
 * ## Forbidden imports
 *
 * - node:* host runtime, not available to a pure consumer
 * - bun:* Bun-only runtime
 * - vscode the VS Code extension host runtime
 * - @effect/platform* platform layers (node/bun bindings)
 * - #lib/runtime, impure internal subtrees that pull in the above #lib/cli,
 *   #lib/runtime-test, #lib/codegen, #lib/loader-hook
 */
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Path, Schema, String } from 'effect';

const pureSubtrees = ['manifest', 'when', 'schema', 'builtins'] as const;

const forbiddenImpureLibSubtrees = [
  'runtime',
  'cli',
  'runtime-test',
  'codegen',
  'loader-hook',
] as const;

const isTestFile = (fileName: string): boolean =>
  String.endsWith('.test.ts')(fileName) ||
  String.endsWith('.test-d.ts')(fileName);

/**
 * @description Returns a violation reason for a forbidden specifier, or null if
 * allowed.
 */
const classify = (specifier: string): string | null => {
  if (String.startsWith('node:')(specifier))
    return `node builtin "${specifier}"`;
  if (String.startsWith('bun:')(specifier)) return `bun builtin "${specifier}"`;
  if (specifier === 'vscode') return `vscode runtime "${specifier}"`;
  if (String.startsWith('@effect/platform')(specifier)) {
    return `effect platform "${specifier}"`;
  }
  for (const subtree of forbiddenImpureLibSubtrees) {
    if (
      specifier === `#lib/${subtree}` ||
      String.startsWith(`#lib/${subtree}/`)(specifier)
    ) {
      return `impure internal subtree "${specifier}"`;
    }
  }
  return null;
};

// Matches the specifier string in static `from '...'`, bare `import '...'`,
// and dynamic `import('...')` forms.
const importSpecifier =
  /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

class ImpureImports extends Schema.TaggedError<ImpureImports, {}>()(
  'ImpureImports',
  {
    violations: Schema.Array(Schema.String),
  },
) {}

const violationsIn = (file: string, source: string): ReadonlyArray<string> => {
  const violations: Array<string> = [];
  let line = 0;
  for (const lineText of String.split(source, '\n')) {
    line++;
    for (const [, , specifier] of String.matchAll(importSpecifier)(lineText)) {
      if (specifier === undefined) continue;
      const reason = classify(specifier);
      if (reason !== null)
        violations.push(`${file}:${globalThis.String(line)}  ${reason}`);
    }
  }
  return violations;
};

const checkPurity = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, '..');
  const violations: Array<string> = [];

  for (const subtree of pureSubtrees) {
    const files = yield* fs.glob(`src/lib/${subtree}/**/*.ts`, { root });
    for (const file of files) {
      if (isTestFile(file)) continue;
      const source = yield* fs.readFileString(path.join(root, file));
      violations.push(...violationsIn(file, source));
    }
  }

  if (violations.length > 0) return yield* ImpureImports.make({ violations });
  yield* Effect.logInfo(
    'Purity guard passed: pure library subset imports only effect + pure internals.',
  );
});

BunRuntime.runMain(Effect.provide(checkPurity, BunServices.layer));
