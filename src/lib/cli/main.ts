import { check } from './commands/check.ts'
import { dev } from './commands/dev.ts'
import { discover } from './commands/discover.ts'
import { lint } from './commands/lint.ts'
import { test } from './commands/test.ts'
import { typecheck } from './commands/typecheck.ts'

const VERSION = '0.0.0'

const HELP_TEXT = `\
vsv — VSCode extension authoring SDK (${VERSION})

Usage:
  vsv <subcommand> [options]

Subcommands:
  dev          Load manifest, run codegen, emit bootstrap, watch for changes
  test         Run tests (shorthand for \`bun test\`)
  lint         Run oxlint with --type-aware --deny-warnings
  typecheck    Run tsgo
  check        Run lint, typecheck, test, and the package.json drift guard
  discover     Print instructions for discovering VSCode commands/context keys

Options:
  --help, -h   Show this help
  --version    Show version

Options specific to \`vsv dev\`:
  --once       Run codegen + bootstrap once, then exit (no watch)
`

export const runCli = async (argv: readonly string[]): Promise<number> => {
  const [subcommand, ...rest] = argv

  if (subcommand === undefined || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(HELP_TEXT)
    return 0
  }

  if (subcommand === '--version') {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }

  switch (subcommand) {
    case 'dev': {
      const once = rest.includes('--once')
      await dev({ once })
      return 0
    }
    case 'test':
      return test(rest)
    case 'lint':
      return lint(rest)
    case 'typecheck':
      return typecheck(rest)
    case 'check':
      return check()
    case 'discover':
      return discover()
    default:
      process.stderr.write(`vsv: unknown subcommand "${subcommand}"\n`)
      process.stderr.write(HELP_TEXT)
      return 1
  }
}
