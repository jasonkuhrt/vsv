import { buildSpawnEnv } from '../spawn-env.ts'

export const lint = async (args: readonly string[] = []): Promise<number> => {
  const proc = Bun.spawn(['oxlint', '--type-aware', '--deny-warnings', ...args], {
    cwd: process.cwd(),
    env: buildSpawnEnv(),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })
  const code = await proc.exited
  return code
}
