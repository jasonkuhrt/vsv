import { Effect, Stdio, Stream } from 'effect';

export const stdout = (text: string) =>
  Effect.flatMap(Stdio.Stdio, (stdio) =>
    Stream.run(Stream.make(text), stdio.stdout()),
  );

export const stderr = (text: string) =>
  Effect.flatMap(Stdio.Stdio, (stdio) =>
    Stream.run(Stream.make(text), stdio.stderr()),
  );
