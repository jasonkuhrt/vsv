import { Array, Config, Effect, Path } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

export const buildSpawnEnv = Effect.fnUntraced(function* (cwd?: string) {
  const path = yield* Path.Path;
  const existingPath = yield* Config.String('PATH').pipe(
    Config.withDefault(''),
  );
  const binPaths: Array<string> = [];
  let current = path.resolve(cwd ?? '.');
  for (
    let parent = path.dirname(current);
    parent !== current;
    parent = path.dirname(current)
  ) {
    binPaths.push(path.join(current, 'node_modules', '.bin'));
    current = parent;
  }
  binPaths.push(path.join(current, 'node_modules', '.bin'));

  const delimiter = path.sep === '\\' ? ';' : ':';
  return {
    PATH: Array.join(
      Array.filter([...binPaths, existingPath], (entry) => entry !== ''),
      delimiter,
    ),
  };
});

export const spawnTool = Effect.fnUntraced(function* (
  tool: string,
  args: ReadonlyArray<string>,
  cwd?: string,
) {
  const env = yield* buildSpawnEnv(cwd);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(
    ChildProcess.make(tool, args, {
      cwd,
      env,
      extendEnv: true,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }),
  );
});
