import { test } from 'bun:test';
import { Cause, Effect, Exit } from 'effect';

export const testEffect = <E>(
  name: string,
  program: Effect.Effect<void, E>,
) => {
  test(name, (done) => {
    Effect.runCallback(program, {
      onExit: (exit) => {
        if (Exit.isFailure(exit)) {
          done(Cause.squash(exit.cause));
        } else {
          done();
        }
      },
    });
  });
};
