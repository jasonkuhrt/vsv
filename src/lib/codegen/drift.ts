// Drift guard: assert `package.json#contributes` matches what the manifest
// would generate. Codegen (`vsv dev`) is the source of truth; a hand-edit to
// the generated `contributes` keys (or a project that never re-ran codegen)
// drifts silently otherwise. Wired into `vsv check`.
//
// Scope: only the *codegen-owned* contribution keys are compared
// (`commands`, `configuration`, `menus`). Un-modeled keys — notably
// `keybindings`, which key-binder owns by design (spec §0) — are
// spread-preserved by codegen and therefore excluded from the drift check.

import { Effect, Equal, Schema } from 'effect';
import type { Manifest } from '#lib/manifest/schema';
import {
  asJsonObject,
  mergeManifestIntoPackageJson,
} from './sync-package-json.ts';
import type { JsonObject } from './sync-package-json.ts';

const OWNED_CONTRIBUTION_KEYS = ['commands', 'configuration', 'menus'] as const;
const JsonValue = Schema.fromJsonString(Schema.Unknown);

export interface DriftResult {
  /**
   * @description `true` when the actual `package.json` matches the manifest's
   * codegen output.
   */
  readonly inSync: boolean;
  /**
   * @description The codegen-owned contribution keys whose actual value differs
   * from generated.
   */
  readonly driftedKeys: ReadonlyArray<string>;
}

/**
 * @description Compute whether `package.json#contributes` is in sync with what
 * `manifest` would generate, restricted to the codegen-owned keys.
 *
 * Compares by deep value equality after JSON normalization (canonical
 * serialization of the generated vs. actual value for each owned key) so key
 * order and `undefined`-vs-absent differences don't produce false drift.
 */
export const computeContributesDrift = Effect.fnUntraced(function* (
  manifest: Manifest,
  packageJson: JsonObject,
) {
  const generated = yield* mergeManifestIntoPackageJson(manifest, packageJson);

  const generatedContributes = asJsonObject(generated['contributes']) ?? {};
  const actualContributes = asJsonObject(packageJson['contributes']) ?? {};

  const driftedKeys: Array<string> = [];
  for (const key of OWNED_CONTRIBUTION_KEYS) {
    const generatedValue = generatedContributes[key];
    const actualValue = actualContributes[key];
    if (generatedValue === undefined || actualValue === undefined) {
      if (generatedValue !== actualValue) driftedKeys.push(key);
    } else {
      const encode = Schema.encodeEffect(JsonValue);
      const generatedJson = yield* encode(generatedValue);
      const actualJson = yield* encode(actualValue);
      const decode = Schema.decodeEffect(JsonValue);
      const generatedData = yield* decode(generatedJson);
      const actualData = yield* decode(actualJson);
      if (!Equal.equals(generatedData, actualData)) driftedKeys.push(key);
    }
  }

  const result: DriftResult = { inSync: driftedKeys.length === 0, driftedKeys };
  return result;
});
