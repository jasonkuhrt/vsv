import { Manifest } from './schema.ts'

type Fields = ConstructorParameters<typeof Manifest>[0]

export const defineManifest = (fields: Fields): Manifest => Manifest.make(fields)
