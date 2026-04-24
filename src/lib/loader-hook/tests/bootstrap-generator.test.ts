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
  test('emits register() via tsx/esm/api plus dynamic import', () => {
    const out = esmBootstrap('src/extension.ts')
    expect(out).toContain("from 'tsx/esm/api'")
    expect(out).toContain('register()')
    expect(out).toContain('"./src/extension.ts"')
    expect(out).toContain('export const activate')
    expect(out).toContain('export const deactivate')
  })

  test('does NOT use the deprecated node:module register(tsx/esm, url) pattern', () => {
    // Regression guard: the old pattern throws under Node 22+ with
    // "tsx must be loaded with --import instead of --loader"
    const out = esmBootstrap('src/extension.ts')
    expect(out).not.toContain("from 'node:module'")
    expect(out).not.toContain("register('tsx/esm'")
    expect(out).not.toContain('pathToFileURL')
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

  // Regression: the emitted ESM bootstrap must actually boot under Node's
  // current ESM runtime without the deprecated --loader pattern. If vsv
  // ever regresses the tsx API it uses, this test catches it in CI rather
  // than at an extension author's F5 attempt.
  test('emitted ESM bootstrap boots successfully under node', async () => {
    // consumer: type=module + minimal src/extension.ts
    await Bun.write(
      path.join(consumerRoot, 'package.json'),
      JSON.stringify({ name: 'ext', type: 'module' }),
    )
    await fs.mkdir(path.join(consumerRoot, 'src'), { recursive: true })
    await Bun.write(
      path.join(consumerRoot, 'src/extension.ts'),
      `export const activate = (_ctx: unknown) => 'ok'\nexport const deactivate = () => {}\n`,
    )

    // Symlink vsv's own node_modules into the consumer so `import 'tsx/esm/api'` resolves.
    // path.resolve from this test file up to the vsv repo root.
    const vsvRoot = path.resolve(import.meta.dir, '../../../..')
    await fs.symlink(
      path.join(vsvRoot, 'node_modules'),
      path.join(consumerRoot, 'node_modules'),
      'dir',
    )

    await generateBootstrap({ consumerRoot })

    const proc = Bun.spawn({
      cmd: [
        'node',
        '--input-type=module',
        '-e',
        `const m = await import("./bootstrap.mjs"); process.stdout.write(typeof m.activate);`,
      ],
      cwd: consumerRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    // Tolerate unrelated Node ExperimentalWarning lines on stderr — fail only
    // on genuine errors like the old "tsx must be loaded with --import" throw.
    if (exitCode !== 0) {
      throw new Error(`bootstrap failed to boot\nexit=${exitCode}\nstderr:\n${stderr}`)
    }
    expect(stdout).toContain('function')
  })
})
