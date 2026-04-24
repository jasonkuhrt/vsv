import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { buildSpawnEnv } from '../spawn-env.ts'

describe('buildSpawnEnv', () => {
  test('prepends cwd/node_modules/.bin to PATH', () => {
    const env = buildSpawnEnv('/some/project')
    const sep = path.delimiter
    const parts = env['PATH']?.split(sep) ?? []
    expect(parts[0]).toBe('/some/project/node_modules/.bin')
  })

  test('walks up parent directories adding every node_modules/.bin', () => {
    const env = buildSpawnEnv('/a/b/c')
    const sep = path.delimiter
    const parts = env['PATH']?.split(sep) ?? []
    // Expect entries for /a/b/c, /a/b, /a, / in that order (ancestor chain)
    expect(parts).toContain('/a/b/c/node_modules/.bin')
    expect(parts).toContain('/a/b/node_modules/.bin')
    expect(parts).toContain('/a/node_modules/.bin')
  })

  test('preserves existing process.env values beyond PATH', () => {
    const env = buildSpawnEnv('/some/project')
    expect(typeof env['HOME']).toBe('string')
  })

  test('preserves existing PATH entries after the prepended bin dirs', () => {
    const env = buildSpawnEnv('/x')
    const parts = env['PATH']?.split(path.delimiter) ?? []
    const originalPathParts = (process.env['PATH'] ?? '').split(path.delimiter)
    for (const orig of originalPathParts) {
      if (orig === '') continue
      expect(parts).toContain(orig)
    }
  })
})
