import type { Manifest } from '#lib/manifest/schema'
import * as path from 'node:path'
import {
  mergeManifestIntoPackageJson,
  readPackageJson,
  writePackageJson,
} from './sync-package-json.ts'

export interface CodegenInputs {
  consumerRoot: string
  manifest: Manifest
}

export interface CodegenResult {
  packageJsonPath: string
}

// Codegen now produces only side-effect artifacts. Registry TypeScript types
// are derived directly from the manifest tuple shape by mapped types in
// `#lib/runtime/registries` — no emitted `.ts` files.
export const runCodegen = async (inputs: CodegenInputs): Promise<CodegenResult> => {
  const { consumerRoot, manifest } = inputs

  const packageJsonPath = path.join(consumerRoot, 'package.json')
  const existing = await readPackageJson(packageJsonPath)
  const merged = mergeManifestIntoPackageJson(manifest, existing)
  await writePackageJson(packageJsonPath, merged)

  return { packageJsonPath }
}
