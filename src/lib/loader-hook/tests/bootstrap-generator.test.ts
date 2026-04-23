import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  cjsBootstrap,
  detectMode,
  esmBootstrap,
  generateBootstrap,
} from '../bootstrap-generator.ts'

let consumerRoot: string

beforeEach(async () => {
  consumerRoot = await fs.mkdtemp(path.join('/tmp', 'vsv-bootstrap-test-'))
})

afterEach(async () => {
  await fs.rm(consumerRoot, { recursive: true, force: true })
})

describe('detectMode', () => {
  test('returns esm when type is module', () => {
    expect(detectMode({ type: 'module' })).toBe('esm')
  })

  test('returns cjs when type is commonjs', () => {
    expect(detectMode({ type: 'commonjs' })).toBe('cjs')
  })

  test('returns cjs when type is missing', () => {
    expect(detectMode({})).toBe('cjs')
  })
})

describe('cjsBootstrap', () => {
  test('emits require(tsx/cjs) plus require of source', () => {
    const out = cjsBootstrap('src/extension.ts')
    expect(out).toContain("require('tsx/cjs')")
    expect(out).toContain('"./src/extension.ts"')
  })
})

describe('esmBootstrap', () => {
  test('emits register(tsx/esm) plus dynamic import', () => {
    const out = esmBootstrap('src/extension.ts')
    expect(out).toContain("register('tsx/esm'")
    expect(out).toContain('"./src/extension.ts"')
    expect(out).toContain('export const activate')
    expect(out).toContain('export const deactivate')
  })
})

describe('generateBootstrap', () => {
  test('writes bootstrap.cjs for a non-module package.json', async () => {
    await Bun.write(path.join(consumerRoot, 'package.json'), JSON.stringify({ name: 'ext' }))
    const result = await generateBootstrap({ consumerRoot })
    expect(result.mode).toBe('cjs')
    expect(result.bootstrapPath.endsWith('/bootstrap.cjs')).toBe(true)
    const text = await Bun.file(result.bootstrapPath).text()
    expect(text).toContain("require('tsx/cjs')")
  })

  test('writes bootstrap.mjs for a type=module package.json', async () => {
    await Bun.write(
      path.join(consumerRoot, 'package.json'),
      JSON.stringify({ name: 'ext', type: 'module' }),
    )
    const result = await generateBootstrap({ consumerRoot })
    expect(result.mode).toBe('esm')
    expect(result.bootstrapPath.endsWith('/bootstrap.mjs')).toBe(true)
    const text = await Bun.file(result.bootstrapPath).text()
    expect(text).toContain('register(')
  })

  test('warns when tsx is missing from dev/dependencies', async () => {
    await Bun.write(path.join(consumerRoot, 'package.json'), JSON.stringify({ name: 'ext' }))
    const result = await generateBootstrap({ consumerRoot })
    expect(result.warnings.join(' ')).toContain('tsx')
  })

  test('does not warn when tsx is in devDependencies', async () => {
    await Bun.write(
      path.join(consumerRoot, 'package.json'),
      JSON.stringify({ name: 'ext', devDependencies: { tsx: '^4.0.0' } }),
    )
    const result = await generateBootstrap({ consumerRoot })
    expect(result.warnings.filter((w) => w.includes('tsx')).length).toBe(0)
  })

  test('warns when main field differs from expected bootstrap', async () => {
    await Bun.write(
      path.join(consumerRoot, 'package.json'),
      JSON.stringify({ name: 'ext', main: './out/extension.js' }),
    )
    const result = await generateBootstrap({ consumerRoot })
    expect(result.warnings.some((w) => w.includes('main'))).toBe(true)
  })

  test('is idempotent — same inputs produce same file content', async () => {
    await Bun.write(
      path.join(consumerRoot, 'package.json'),
      JSON.stringify({ name: 'ext', type: 'module', devDependencies: { tsx: '^4.0.0' } }),
    )
    const r1 = await generateBootstrap({ consumerRoot })
    const first = await Bun.file(r1.bootstrapPath).text()
    const r2 = await generateBootstrap({ consumerRoot })
    const second = await Bun.file(r2.bootstrapPath).text()
    expect(first).toBe(second)
  })
})
