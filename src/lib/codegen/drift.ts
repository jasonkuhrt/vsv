// Drift guard: assert `package.json#contributes` matches what the manifest
// would generate. Codegen (`vsv dev`) is the source of truth; a hand-edit to
// the generated `contributes` keys (or a project that never re-ran codegen)
// drifts silently otherwise. Wired into `vsv check`.
//
// Scope: only the *codegen-owned* contribution keys are compared
// (`commands`, `configuration`, `menus`). Un-modeled keys — notably
// `keybindings`, which key-binder owns by design (spec §0) — are
// spread-preserved by codegen and therefore excluded from the drift check.

import type { Manifest } from '#lib/manifest/schema'
import { mergeManifestIntoPackageJson } from './sync-package-json.ts'

type JsonObject = { [k: string]: unknown }

/** Contribution keys vsv codegen owns and therefore drift-checks. */
const OWNED_CONTRIBUTION_KEYS = ['commands', 'configuration', 'menus'] as const

const asJsonObject = (u: unknown): JsonObject | undefined => {
  if (u === null || typeof u !== 'object' || Array.isArray(u)) return undefined
  return u as JsonObject
}

export interface DriftResult {
  /** `true` when the actual `package.json` matches the manifest's codegen output. */
  readonly inSync: boolean
  /** The codegen-owned contribution keys whose actual value differs from generated. */
  readonly driftedKeys: ReadonlyArray<string>
}

/**
 * Compute whether `package.json#contributes` is in sync with what `manifest`
 * would generate, restricted to the codegen-owned keys.
 *
 * Compares by deep value equality after JSON normalization (canonical
 * serialization of the generated vs. actual value for each owned key) so key
 * order and `undefined`-vs-absent differences don't produce false drift.
 */
export const computeContributesDrift = (
  manifest: Manifest,
  packageJson: JsonObject,
): DriftResult => {
  const generated = mergeManifestIntoPackageJson(manifest, packageJson)

  const generatedContributes = asJsonObject(generated['contributes']) ?? {}
  const actualContributes = asJsonObject(packageJson['contributes']) ?? {}

  const driftedKeys: Array<string> = []
  for (const key of OWNED_CONTRIBUTION_KEYS) {
    // `JSON.stringify(undefined)` is `undefined`; an absent key on both sides
    // compares equal (both `undefined`), so a manifest that contributes
    // nothing for a key and a package.json that omits it are in sync.
    const generatedJson = JSON.stringify(generatedContributes[key])
    const actualJson = JSON.stringify(actualContributes[key])
    if (generatedJson !== actualJson) driftedKeys.push(key)
  }

  return { inSync: driftedKeys.length === 0, driftedKeys }
}
