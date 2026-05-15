import * as path from 'node:path'
import { runCodegen } from '#lib/codegen/engine'
import { generateBootstrap } from '#lib/loader-hook/bootstrap-generator'
import type { Manifest } from '#lib/manifest/schema'

interface ManifestModule {
  default?: Manifest
}

const loadManifest = async (consumerRoot: string): Promise<Manifest> => {
  const manifestPath = path.join(consumerRoot, 'vsv.manifest.ts')
  const mod = (await import(manifestPath)) as ManifestModule
  if (mod.default === undefined) {
    throw new Error(`${manifestPath} must have a default export of type Manifest`)
  }
  return mod.default
}

const runOnce = async (consumerRoot: string): Promise<void> => {
  const manifest = await loadManifest(consumerRoot)
  const codegenResult = await runCodegen({ consumerRoot, manifest })
  process.stdout.write(`updated ${codegenResult.packageJsonPath}\n`)
  const bootstrapResult = await generateBootstrap({ consumerRoot })
  process.stdout.write(`wrote ${bootstrapResult.bootstrapPath}\n`)
  for (const w of bootstrapResult.warnings) {
    process.stdout.write(`warning: ${w}\n`)
  }
}

const watchAndRun = async (consumerRoot: string): Promise<void> => {
  const fs = await import('node:fs')
  const manifestPath = path.join(consumerRoot, 'vsv.manifest.ts')
  process.stdout.write(`vsv dev: watching ${manifestPath}\n`)

  await runOnce(consumerRoot)

  let pending = false
  let inFlight = false

  const run = async (): Promise<void> => {
    if (inFlight) {
      pending = true
      return
    }
    inFlight = true
    try {
      await runOnce(consumerRoot)
    } catch (err) {
      process.stderr.write(`vsv dev: error ${err instanceof Error ? err.message : String(err)}\n`)
    } finally {
      inFlight = false
      if (pending) {
        pending = false
        void run()
      }
    }
  }

  const watcher = fs.watch(manifestPath, () => {
    void run()
  })

  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      watcher.close()
      resolve()
    })
  })
}

export interface DevOptions {
  once?: boolean
  consumerRoot?: string
}

export const dev = async (options: DevOptions = {}): Promise<void> => {
  const consumerRoot = options.consumerRoot ?? process.cwd()
  if (options.once === true) {
    await runOnce(consumerRoot)
    return
  }
  await watchAndRun(consumerRoot)
}
