export const typecheck = async (args: readonly string[] = []): Promise<number> => {
  const proc = Bun.spawn(['tsgo', ...args], {
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })
  const code = await proc.exited
  return code
}
