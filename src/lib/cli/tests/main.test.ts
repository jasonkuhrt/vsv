import { describe, expect, test } from 'bun:test'
import { runCli } from '../main.ts'

describe('runCli', () => {
  test('returns 0 for --help', async () => {
    const code = await runCli(['--help'])
    expect(code).toBe(0)
  })

  test('returns 0 for no args (prints help)', async () => {
    const code = await runCli([])
    expect(code).toBe(0)
  })

  test('returns 0 for --version', async () => {
    const code = await runCli(['--version'])
    expect(code).toBe(0)
  })

  test('returns 0 for discover', async () => {
    const code = await runCli(['discover'])
    expect(code).toBe(0)
  })

  test('returns 1 for unknown subcommand', async () => {
    const code = await runCli(['bogus'])
    expect(code).toBe(1)
  })
})
