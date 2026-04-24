import * as path from 'node:path'

/**
 * Build a subprocess environment with the consumer's local
 * `node_modules/.bin` prepended to PATH. Fixes ENOENT errors when the
 * `vsv` CLI is invoked globally (outside `bun run`) and spawns tools
 * like `oxlint` or `tsgo` that the consumer installed locally.
 *
 * Walks up from the given cwd looking for `node_modules/.bin`, prepending
 * every match. This handles monorepos where bin directories exist at
 * multiple levels (package-local + workspace-root).
 */
export const buildSpawnEnv = (cwd: string = process.cwd()): Record<string, string> => {
  const binPaths: string[] = []
  let current = path.resolve(cwd)
  for (let parent = path.dirname(current); parent !== current; parent = path.dirname(current)) {
    binPaths.push(path.join(current, 'node_modules', '.bin'))
    current = parent
  }
  binPaths.push(path.join(current, 'node_modules', '.bin'))

  const currentPath = process.env['PATH'] ?? ''
  const newPath = [...binPaths, currentPath].filter(Boolean).join(path.delimiter)

  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  env['PATH'] = newPath
  return env
}
