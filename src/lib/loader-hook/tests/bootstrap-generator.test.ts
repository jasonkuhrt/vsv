import { describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import type { Scope } from 'effect';
import { Array, Effect, FileSystem, Path, Stream, String } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { writePackageJson } from '../../codegen/sync-package-json.ts';
import { testEffect } from '../../runtime-test/test-effect.ts';
import {
  cjsBootstrap,
  detectMode,
  esmBootstrap,
  generateBootstrap,
} from '../bootstrap-generator.ts';

describe('detectMode', () => {
  test('returns esm when type is module', () => {
    expect(detectMode({ type: 'module' })).toBe('esm');
  });

  test('returns cjs when type is commonjs', () => {
    expect(detectMode({ type: 'commonjs' })).toBe('cjs');
  });

  test('returns cjs when type is missing', () => {
    expect(detectMode({})).toBe('cjs');
  });
});

describe('cjsBootstrap', () => {
  test('emits require(tsx/cjs) plus require of source', () => {
    const out = Effect.runSync(cjsBootstrap('src/extension.ts'));
    expect(out).toContain("require('tsx/cjs')");
    expect(out).toContain('"./src/extension.ts"');
  });
});

describe('esmBootstrap', () => {
  test('emits register() via tsx/esm/api plus dynamic import', () => {
    const out = Effect.runSync(esmBootstrap('src/extension.ts'));
    expect(out).toContain("from 'tsx/esm/api'");
    expect(out).toContain('register()');
    expect(out).toContain('"./src/extension.ts"');
    expect(out).toContain('export const activate');
    expect(out).toContain('export const deactivate');
  });

  test('does NOT use the deprecated node:module register(tsx/esm, url) pattern', () => {
    // Regression guard: the old pattern throws under Node 22+ with
    // "tsx must be loaded with --import instead of --loader"
    const out = Effect.runSync(esmBootstrap('src/extension.ts'));
    expect(out).not.toContain("from 'node:module'");
    expect(out).not.toContain("register('tsx/esm'");
    expect(out).not.toContain('pathToFileURL');
  });
});

interface Consumer {
  readonly consumerRoot: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
}

const withConsumer = <E>(
  name: string,
  body: (
    consumer: Consumer,
  ) => Effect.fn.Return<void, E, BunServices.BunServices | Scope.Scope>,
) => {
  testEffect(
    name,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const consumerRoot = yield* fs.makeTempDirectoryScoped({
        prefix: 'vsv-bootstrap-',
      });
      yield* Effect.gen(() => body({ consumerRoot, fs, path }));
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
};

describe('generateBootstrap', () => {
  withConsumer(
    'writes bootstrap.cjs for a non-module package.json',
    function* ({ consumerRoot, fs, path }) {
      yield* writePackageJson(path.join(consumerRoot, 'package.json'), {
        name: 'ext',
      });
      const result = yield* generateBootstrap({ consumerRoot });
      expect(result.mode).toBe('cjs');
      expect(String.endsWith('/bootstrap.cjs')(result.bootstrapPath)).toBe(
        true,
      );
      const text = yield* fs.readFileString(result.bootstrapPath);
      expect(text).toContain("require('tsx/cjs')");
    },
  );

  withConsumer(
    'writes bootstrap.mjs for a type=module package.json',
    function* ({ consumerRoot, fs, path }) {
      yield* writePackageJson(path.join(consumerRoot, 'package.json'), {
        name: 'ext',
        type: 'module',
      });
      const result = yield* generateBootstrap({ consumerRoot });
      expect(result.mode).toBe('esm');
      expect(String.endsWith('/bootstrap.mjs')(result.bootstrapPath)).toBe(
        true,
      );
      const text = yield* fs.readFileString(result.bootstrapPath);
      expect(text).toContain('register(');
    },
  );

  withConsumer(
    'warns when tsx is missing from dev/dependencies',
    function* ({ consumerRoot, path }) {
      yield* writePackageJson(path.join(consumerRoot, 'package.json'), {
        name: 'ext',
      });
      const result = yield* generateBootstrap({ consumerRoot });
      expect(Array.join(result.warnings, ' ')).toContain('tsx');
    },
  );

  withConsumer(
    'does not warn when tsx is in devDependencies',
    function* ({ consumerRoot, path }) {
      yield* writePackageJson(path.join(consumerRoot, 'package.json'), {
        name: 'ext',
        devDependencies: { tsx: '^4.0.0' },
      });
      const result = yield* generateBootstrap({ consumerRoot });
      expect(Array.filter(result.warnings, String.includes('tsx')).length).toBe(
        0,
      );
    },
  );

  withConsumer(
    'warns when main field differs from expected bootstrap',
    function* ({ consumerRoot, path }) {
      yield* writePackageJson(path.join(consumerRoot, 'package.json'), {
        name: 'ext',
        main: './out/extension.js',
      });
      const result = yield* generateBootstrap({ consumerRoot });
      expect(Array.some(result.warnings, String.includes('main'))).toBe(true);
    },
  );

  withConsumer(
    'is idempotent — same inputs produce same file content',
    function* ({ consumerRoot, fs, path }) {
      yield* writePackageJson(path.join(consumerRoot, 'package.json'), {
        name: 'ext',
        type: 'module',
        devDependencies: { tsx: '^4.0.0' },
      });
      const r1 = yield* generateBootstrap({ consumerRoot });
      const first = yield* fs.readFileString(r1.bootstrapPath);
      const r2 = yield* generateBootstrap({ consumerRoot });
      const second = yield* fs.readFileString(r2.bootstrapPath);
      expect(first).toBe(second);
    },
  );

  // Regression: the emitted ESM bootstrap must actually boot under Node's
  // current ESM runtime without the deprecated --loader pattern. If vsv
  // ever regresses the tsx API it uses, this test catches it in CI rather
  // than at an extension author's F5 attempt.
  withConsumer(
    'emitted ESM bootstrap boots successfully under node',
    function* ({ consumerRoot, fs, path }) {
      // consumer: type=module + minimal src/extension.ts
      yield* writePackageJson(path.join(consumerRoot, 'package.json'), {
        name: 'ext',
        type: 'module',
      });
      yield* fs.makeDirectory(path.join(consumerRoot, 'src'), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(consumerRoot, 'src/extension.ts'),
        `export const activate = (_ctx: unknown) => 'ok'\nexport const deactivate = () => {}\n`,
      );

      // Symlink vsv's own node_modules into the consumer so `import 'tsx/esm/api'` resolves.
      // path.resolve from this test file up to the vsv repo root.
      const vsvRoot = path.resolve(import.meta.dir, '../../../..');
      yield* fs.symlink(
        path.join(vsvRoot, 'node_modules'),
        path.join(consumerRoot, 'node_modules'),
      );

      yield* generateBootstrap({ consumerRoot });

      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner.spawn(
        ChildProcess.make(
          'node',
          [
            '--input-type=module',
            '-e',
            `import { activate } from './bootstrap.mjs'; process.stdout.write(typeof activate);`,
          ],
          { cwd: consumerRoot },
        ),
      );
      const output = yield* Effect.all(
        {
          code: child.exitCode,
          stdout: child.stdout.pipe(
            Stream.decodeText,
            Stream.runFold(
              () => '',
              (a, b) => a + b,
            ),
          ),
          stderr: child.stderr.pipe(
            Stream.decodeText,
            Stream.runFold(
              () => '',
              (a, b) => a + b,
            ),
          ),
        },
        { concurrency: 'unbounded' },
      );
      expect({ code: Number(output.code), stdout: output.stdout }).toEqual({
        code: 0,
        stdout: 'function',
      });
    },
  );
});
