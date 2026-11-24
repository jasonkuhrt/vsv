import { spawnTool } from '../spawn-env.ts';

export const typecheck = (args: ReadonlyArray<string> = []) =>
  spawnTool('tsrs', ['--noEmit', '--fast', ...args]);
