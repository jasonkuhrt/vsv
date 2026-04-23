export const test = async (args: readonly string[] = []): Promise<number> => {
  const proc = Bun.spawn(['bun', 'test', ...args], {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })
  const code = await proc.exited
  return code
}
