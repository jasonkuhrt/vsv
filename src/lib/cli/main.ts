import { Effect } from 'effect';
import { check } from './commands/check.ts';
import { dev } from './commands/dev.ts';
import { discover } from './commands/discover.ts';
import { lint } from './commands/lint.ts';
import { test } from './commands/test.ts';
import { typecheck } from './commands/typecheck.ts';
import { stderr, stdout } from './output.ts';

const VERSION = '0.0.0';

const HELP_TEXT = `\
vsv — VSCode extension authoring SDK (${VERSION})

Usage:
  vsv <subcommand> [options]

Subcommands:
  dev          Load manifest, run codegen, emit bootstrap, watch for changes
  test         Run tests (shorthand for \`bun test\`)
  lint         Run oxlint with --type-aware --deny-warnings
  typecheck    Run tsrs
  check        Run lint, typecheck, test, and the package.json drift guard
  discover     Print instructions for discovering VSCode commands/context keys

Options:
  --help, -h   Show this help
  --version    Show version

Options specific to \`vsv dev\`:
  --once       Run codegen + bootstrap once, then exit (no watch)
`;

export const runCli = Effect.fnUntraced(function* (
  argv: ReadonlyArray<string>,
  entrypoint: string,
) {
  const [subcommand, ...rest] = argv;

  if (
    subcommand === undefined ||
    subcommand === '--help' ||
    subcommand === '-h'
  ) {
    yield* stdout(HELP_TEXT);
    return 0;
  }

  if (subcommand === '--version') {
    yield* stdout(`${VERSION}\n`);
    return 0;
  }

  switch (subcommand) {
    case 'dev': {
      const once = rest.includes('--once');
      yield* dev({ once, entrypoint });
      return 0;
    }
    case 'test':
      return yield* test(rest);
    case 'lint':
      return yield* lint(rest);
    case 'typecheck':
      return yield* typecheck(rest);
    case 'check':
      return yield* check();
    case 'discover':
      return yield* discover;
    default:
      yield* stderr(`vsv: unknown subcommand "${subcommand}"\n`);
      yield* stderr(HELP_TEXT);
      return 1;
  }
});
