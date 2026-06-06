/**
 * Post-build: rewrite the package-internal `#lib/*` import specifier to a
 * relative path inside `build/`, so the compiled artifacts are self-contained.
 *
 * Why this exists
 * ---------------
 * `package.json#imports` maps `"#lib/*": "./src/lib/*.ts"`. That mapping is what
 * lets source (`src`) and `bun test` resolve internal modules without relative
 * path soup. But the bare `#lib/...` specifier survives `tsgo` emit into the
 * compiled `build/**` artifacts (tsgo does not rewrite subpath-imports). A
 * downstream consumer of the *compiled* `/manifest` or `/when` therefore
 * resolves `#lib/...` back through the package's own `imports` map to raw
 * `./src/lib/*.ts` — pulling un-built TypeScript into a plain-JS consumer.
 *
 * This step makes `build/**` self-contained: every `#lib/X` becomes a relative
 * path from the emitting file to `build/lib/X`, with the extension that file
 * type already uses for its other relative imports:
 *   - `.js`   files →  `#lib/X` → `./relative/X.js`   (rewriteRelativeImportExtensions emit)
 *   - `.d.ts` files →  `#lib/X` → `./relative/X.ts`   (TS declaration convention here)
 *
 * `package.json#imports` is left pointing at `src` so source-level testing
 * (`bun test src tests`) and `tsgo` typechecking keep resolving against `.ts`.
 */
import * as Fs from 'node:fs'
import * as Path from 'node:path'

const buildDir = Path.resolve(import.meta.dirname, '..', 'build')
const buildLibDir = Path.join(buildDir, 'lib')

// Matches the specifier in `from '#lib/...'`, `import '#lib/...'`, and the
// dynamic `import('#lib/...')` form. Captures the quote and the path tail.
const libSpecifier = /(['"])#lib\/([^'"]+)\1/g

const rewriteFile = (filePath: string): boolean => {
  const isDeclaration = filePath.endsWith('.d.ts')
  // `.d.ts` relative imports carry `.ts`; `.js` relative imports carry `.js`.
  const extension = isDeclaration ? '.ts' : '.js'
  const fileDir = Path.dirname(filePath)

  const source = Fs.readFileSync(filePath, 'utf8')

  const next = source.replace(libSpecifier, (_match, quote: string, tail: string) => {
    const target = Path.join(buildLibDir, `${tail}${extension}`)
    let relative = Path.relative(fileDir, target)
    // Node ESM requires an explicit `./` (or `../`) leader on relative imports.
    if (!relative.startsWith('.')) relative = `./${relative}`
    // Normalize Windows separators to POSIX for portable specifiers.
    relative = relative.replaceAll(Path.sep, '/')
    return `${quote}${relative}${quote}`
  })

  if (next === source) return false
  Fs.writeFileSync(filePath, next)
  return true
}

const walk = function* (dir: string): Generator<string> {
  for (const entry of Fs.readdirSync(dir, { withFileTypes: true })) {
    const full = Path.join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
      yield full
    }
  }
}

if (!Fs.existsSync(buildDir)) {
  console.error(`rewrite-lib-imports: build directory not found at ${buildDir}`)
  process.exit(1)
}

let rewritten = 0
for (const file of walk(buildDir)) {
  if (rewriteFile(file)) rewritten++
}

console.error(`rewrite-lib-imports: rewrote #lib/* specifiers in ${rewritten} file(s)`)
