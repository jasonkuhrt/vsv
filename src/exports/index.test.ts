import { expect, test } from 'bun:test';
import { Effect } from 'effect';
import { defineManifest, createRuntime, VERSION } from './index.ts';
import { installVSCodeMock } from './runtime-test.ts';

test('exports the version and runs a fixture without a VS Code host', () => {
  const manifest = defineManifest({
    name: 'test-extension',
    publisher: 'test',
  });
  const fixture = installVSCodeMock();
  const runtime = Effect.runSync(
    createRuntime(manifest).pipe(Effect.provide(fixture.layer)),
  );
  expect(VERSION).toBe('0.0.0');
  expect(Effect.runSync(runtime.editor.active)).toBeUndefined();
});
