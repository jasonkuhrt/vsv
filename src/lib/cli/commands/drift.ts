import * as fs from 'node:fs'
import * as path from 'node:path'
import { computeContributesDrift } from '#lib/codegen/drift'
import { readPackageJson } from '#lib/codegen/sync-package-json'
import type { Manifest } from '#lib/manifest/schema'

interface ManifestModule {
  default?: Manifest
}

const loadManifest = async (manifestPath: string): Promise<Manifest> => {
  const mod = (await import(manifestPath)) as ManifestModule
  if (mod.default === undefined) {
    throw new Error(`${manifestPath} must have a default export of type Manifest`)
  }
  return mod.default
}

export interface DriftOptions {
  consumerRoot?: string
}

/**
 * `vsv check` drift guard. Loads the consumer's `vsv.manifest.ts`, reads its
 * `package.json`, and fails if the codegen-owned `contributes` keys
 * (`commands` / `configuration` / `menus`) differ from what the manifest
 * would generate. Run `vsv dev --once` to regenerate when this fails.
 *
 * Skips (returns `0`) when the consumer root has no `vsv.manifest.ts` — a
 * non-extension repo (e.g. vsv itself) has nothing to drift-check.
 *
 * Returns a process exit code: `0` in sync / skipped, `1` drifted.
 */
export const drift = async (options: DriftOptions = {}): Promise<number> => {
  const consumerRoot = options.consumerRoot ?? process.cwd()
  const manifestPath = path.join(consumerRoot, 'vsv.manifest.ts')
  if (!fs.existsSync(manifestPath)) {
    process.stdout.write('vsv check: no vsv.manifest.ts — skipping contributes drift check\n')
    return 0
  }

  const manifest = await loadManifest(manifestPath)
  const packageJsonPath = path.join(consumerRoot, 'package.json')
  const packageJson = await readPackageJson(packageJsonPath)

  const result = computeContributesDrift(manifest, packageJson)
  if (result.inSync) {
    process.stdout.write('vsv check: package.json contributes in sync with manifest\n')
    return 0
  }

  process.stderr.write(
    `vsv check: package.json#contributes is out of sync with the manifest.\n` +
      `  Drifted keys: ${result.driftedKeys.join(', ')}\n` +
      `  Run \`vsv dev --once\` to regenerate ${packageJsonPath}.\n`,
  )
  return 1
}
