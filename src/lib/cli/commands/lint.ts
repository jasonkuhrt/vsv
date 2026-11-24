import { spawnTool } from '../spawn-env.ts';

export const lint = (args: ReadonlyArray<string> = []) =>
  spawnTool('oxlint', ['--type-aware', '--deny-warnings', ...args]);
