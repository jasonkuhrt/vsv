import type { Manifest } from '#lib/manifest/schema'
import { WhenClause } from '#lib/when/when'
import { JSONSchema, Schema } from 'effect'

type JsonObject = { [k: string]: unknown }

const hasAst = (u: unknown): u is { ast: unknown } => {
  if (u === null) return false
  if (typeof u !== 'object' && typeof u !== 'function') return false
  return 'ast' in u
}

const asSchema = (u: unknown): Schema.Schema.All | undefined => {
  if (u === undefined) return undefined
  if (!hasAst(u)) return undefined
  return u as Schema.Schema.All
}

const asJsonObject = (u: unknown): JsonObject | undefined => {
  if (u === null || typeof u !== 'object' || Array.isArray(u)) return undefined
  return u as JsonObject
}

export const mergeManifestIntoPackageJson = (
  manifest: Manifest,
  existingPackageJson: JsonObject,
): JsonObject => {
  const result: JsonObject = { ...existingPackageJson }

  result['name'] = manifest.name
  result['publisher'] = manifest.publisher
  if (manifest.displayName !== undefined) result['displayName'] = manifest.displayName
  if (manifest.description !== undefined) result['description'] = manifest.description
  if (manifest.version !== undefined) result['version'] = manifest.version

  if (manifest.engineVscode !== undefined) {
    const engines: JsonObject = { ...asJsonObject(existingPackageJson['engines']) }
    engines['vscode'] = manifest.engineVscode
    result['engines'] = engines
  }

  if (manifest.activationEvents !== undefined) {
    result['activationEvents'] = [...manifest.activationEvents]
  }

  if (manifest.extensionDependencies !== undefined) {
    result['extensionDependencies'] = [...manifest.extensionDependencies]
  }

  const contributes: JsonObject = { ...asJsonObject(existingPackageJson['contributes']) }

  if (manifest.commands !== undefined) {
    contributes['commands'] = manifest.commands.map((c) => {
      const entry: JsonObject = { command: c.id }
      if (c.title !== undefined) entry['title'] = c.title
      if (c.category !== undefined) entry['category'] = c.category
      return entry
    })
  }

  if (manifest.config !== undefined && manifest.config.length > 0) {
    const properties: JsonObject = {}
    for (const c of manifest.config) {
      const schema = asSchema(c.valueSchema)
      const rawJsonSchema: unknown = schema ? JSONSchema.make(schema as Schema.Schema<unknown>) : {}
      const entry: JsonObject = { ...(asJsonObject(rawJsonSchema) ?? {}) }
      if (c.description !== undefined) {
        entry['description'] = c.description
      }
      properties[c.key] = entry
    }
    contributes['configuration'] = { type: 'object', properties }
  }

  if (manifest.menus !== undefined && manifest.menus.length > 0) {
    // `contributes.menus` is keyed by menu location (`explorer/context`,
    // `commandPalette`, …); each value is the array of entries for that
    // location, in declared order. The flat `MenuDecl[]` is grouped here.
    const menus: { [location: string]: Array<JsonObject> } = {}
    for (const m of manifest.menus) {
      const entry: JsonObject = { command: m.command }
      if (m.when !== undefined) {
        // Serialize the `WhenAst` to VS Code's canonical clause string. This
        // is the first codegen consumer of the when builder's codec.
        entry['when'] = Schema.encodeSync(WhenClause)(m.when)
      }
      if (m.group !== undefined) entry['group'] = m.group
      ;(menus[m.location] ??= []).push(entry)
    }
    contributes['menus'] = menus
  }

  if (Object.keys(contributes).length > 0) {
    result['contributes'] = contributes
  }

  return result
}

export const writePackageJson = async (path: string, data: JsonObject): Promise<void> => {
  const serialized = `${JSON.stringify(data, null, 2)}\n`
  await Bun.write(path, serialized)
}

export const readPackageJson = async (path: string): Promise<JsonObject> => {
  const raw: unknown = await Bun.file(path).json()
  const obj = asJsonObject(raw)
  if (obj === undefined) {
    throw new Error(`Expected package.json at ${path} to be a JSON object`)
  }
  return obj
}
