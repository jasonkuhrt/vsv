import { spawnTool } from '../spawn-env.ts';

export const test = (args: ReadonlyArray<string> = []) =>
  spawnTool('bun', ['test', ...args]);
