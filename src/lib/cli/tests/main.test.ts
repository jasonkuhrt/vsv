import { describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer, Stdio } from 'effect';
import { runCli } from '../main.ts';

const layer = Layer.merge(BunServices.layer, Stdio.layerTest({}));

describe('runCli', () => {
  test('returns 0 for --help', () => {
    const code = Effect.runSync(
      Effect.provide(runCli(['--help'], import.meta.filename), layer),
    );
    expect(code).toBe(0);
  });

  test('returns 0 for no args (prints help)', () => {
    const code = Effect.runSync(
      Effect.provide(runCli([], import.meta.filename), layer),
    );
    expect(code).toBe(0);
  });

  test('returns 0 for --version', () => {
    const code = Effect.runSync(
      Effect.provide(runCli(['--version'], import.meta.filename), layer),
    );
    expect(code).toBe(0);
  });

  test('returns 0 for discover', () => {
    const code = Effect.runSync(
      Effect.provide(runCli(['discover'], import.meta.filename), layer),
    );
    expect(code).toBe(0);
  });

  test('returns 1 for unknown subcommand', () => {
    const code = Effect.runSync(
      Effect.provide(runCli(['bogus'], import.meta.filename), layer),
    );
    expect(code).toBe(1);
  });
});
