/**
 * Purity guard for vsv's pure library subset.
 *
 * The pure subset (`/manifest`, `/when`, and the future `/builtins`) must be
 * consumable as self-contained JS whose only runtime dependency is `effect`.
 * That holds only while the *shipping* modules under the pure subtrees import
 * nothing impure. This guard fails CI the moment an impure import sneaks in.
 *
 * Scope
 * -----
 * Scans the shipping modules under:
 *   - src/lib/manifest/**
 *   - src/lib/when/**
 *   - src/lib/schema/**
 *   - src/lib/builtins/**   (future — Phase B; tolerated-absent today)
 *
 * Test files (`*.test.ts`, `*.test-d.ts`) are excluded: they are NOT part of
 * the consumable surface (excluded from `build` via tsconfig.build.json) and
 * legitimately import `bun:test`. The guard protects what ships, not the tests.
 *
 * Forbidden imports
 * -----------------
 *   - node:*               host runtime, not available to a pure consumer
 *   - bun:*                Bun-only runtime
 *   - vscode               the VS Code extension host runtime
 *   - @effect/platform*    platform layers (node/bun bindings)
 *   - #lib/runtime,        impure internal subtrees that pull in the above
 *     #lib/cli, #lib/runtime-test, #lib/codegen, #lib/loader-hook
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'

const srcLibDir = Path.resolve(import.meta.dirname, '..', 'src', 'lib')

const pureSubtrees = ['manifest', 'when', 'schema', 'builtins'] as const

const forbiddenImpureLibSubtrees = [
  'runtime',
  'cli',
  'runtime-test',
  'codegen',
  'loader-hook',
] as const

const isTestFile = (fileName: string): boolean =>
  fileName.endsWith('.test.ts') || fileName.endsWith('.test-d.ts')

/**
 * Returns a violation reason for a forbidden specifier, or null if allowed.
 */
const classify = (specifier: string): string | null => {
  if (specifier.startsWith('node:')) return `node builtin "${specifier}"`
  if (specifier.startsWith('bun:')) return `bun builtin "${specifier}"`
  if (specifier === 'vscode') return `vscode runtime "${specifier}"`
  if (specifier === '@effect/platform' || specifier.startsWith('@effect/platform')) {
    return `effect platform "${specifier}"`
  }
  for (const subtree of forbiddenImpureLibSubtrees) {
    if (specifier === `#lib/${subtree}` || specifier.startsWith(`#lib/${subtree}/`)) {
      return `impure internal subtree "${specifier}"`
    }
  }
  return null
}

// Matches the specifier string in static `from '...'`, bare `import '...'`,
// and dynamic `import('...')` forms.
const importSpecifier =
  /(?:\bfrom\s*|\bimport\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g

const walk = function* (dir: string): Generator<string> {
  for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
    const full = Path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.name.endsWith('.ts') && !isTestFile(entry.name)) {
      yield full
    }
  }
}

interface Violation {
  file: string
  line: number
  specifier: string
  reason: string
}

const violations: Violation[] = []

for (const subtree of pureSubtrees) {
  const dir = Path.join(srcLibDir, subtree)
  if (!Fs.existsSync(dir)) continue // future subtree (builtins) — tolerated absent
  for (const file of walk(dir)) {
    const source = Fs.readFileSync(file, 'utf8')
    const lines = source.split('\n')
    lines.forEach((lineText, index) => {
      for (const match of lineText.matchAll(importSpecifier)) {
        const specifier = match[2]
        if (specifier === undefined) continue
        const reason = classify(specifier)
        if (reason) {
          violations.push({
            file: Path.relative(Path.join(srcLibDir, '..', '..'), file),
            line: index + 1,
            specifier,
            reason,
          })
        }
      }
    })
  }
}

if (violations.length > 0) {
  console.error('Purity guard FAILED — impure imports found in the pure library subset:\n')
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.reason}`)
  }
  console.error(
    `\nThe pure subset (/manifest, /when, /builtins) must import only "effect" and` +
      ` pure #lib subtrees. ${violations.length} violation(s).`,
  )
  process.exit(1)
}

console.error('Purity guard passed: pure library subset imports only effect + pure internals.')
