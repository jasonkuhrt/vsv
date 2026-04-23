import type { Manifest } from '#lib/manifest/schema'
import * as path from 'node:path'
import { emitRegistries } from './emit-registries.ts'
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
  registriesPath: string
  packageJsonPath: string
}

export const runCodegen = async (inputs: CodegenInputs): Promise<CodegenResult> => {
  const { consumerRoot, manifest } = inputs

  const registriesPath = path.join(consumerRoot, 'src', 'generated', 'registries.ts')
  const registriesContent = emitRegistries(manifest)
  await Bun.write(registriesPath, registriesContent)

  const packageJsonPath = path.join(consumerRoot, 'package.json')
  const existing = await readPackageJson(packageJsonPath)
  const merged = mergeManifestIntoPackageJson(manifest, existing)
  await writePackageJson(packageJsonPath, merged)

  return { registriesPath, packageJsonPath }
}
