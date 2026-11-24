#!/usr/bin/env bun
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, Exit, Runtime, Stdio } from 'effect';
import { runCli } from '#lib/cli/main';

BunRuntime.runMain(
  Stdio.Stdio.pipe(
    Effect.flatMap((stdio) => stdio.args),
    Effect.flatMap((args) => runCli(args, import.meta.filename)),
    Effect.provide(BunServices.layer),
  ),
  {
    teardown: (exit, onExit) => {
      if (Exit.isSuccess(exit) && typeof exit.value === 'number') {
        onExit(exit.value);
      } else {
        Runtime.defaultTeardown(exit, onExit);
      }
    },
  },
);
