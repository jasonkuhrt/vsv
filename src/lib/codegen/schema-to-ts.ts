import { type Schema, SchemaAST } from 'effect'

export interface EmitOptions {
  indent?: string
}

export const schemaToTs = (schema: Schema.Schema.All, options?: EmitOptions): string => {
  return emitNode(schema.ast, options?.indent ?? '  ', 0)
}

const emitNode = (ast: SchemaAST.AST, indent: string, depth: number): string => {
  if (SchemaAST.isStringKeyword(ast)) return 'string'
  if (SchemaAST.isNumberKeyword(ast)) return 'number'
  if (SchemaAST.isBooleanKeyword(ast)) return 'boolean'
  if (SchemaAST.isVoidKeyword(ast)) return 'void'
  if (SchemaAST.isUndefinedKeyword(ast)) return 'undefined'
  if (SchemaAST.isNeverKeyword(ast)) return 'never'
  if (SchemaAST.isUnknownKeyword(ast)) return 'unknown'
  if (SchemaAST.isAnyKeyword(ast)) return 'unknown'
  if (SchemaAST.isBigIntKeyword(ast)) return 'bigint'
  if (SchemaAST.isSymbolKeyword(ast)) return 'symbol'

  if (SchemaAST.isLiteral(ast)) {
    const v = ast.literal
    if (v === null) return 'null'
    if (typeof v === 'string') return JSON.stringify(v)
    if (typeof v === 'number') return String(v)
    if (typeof v === 'boolean') return String(v)
    if (typeof v === 'bigint') return `${v.toString()}n`
    return 'unknown'
  }

  if (SchemaAST.isTupleType(ast)) {
    const firstRest = ast.rest[0]
    if (firstRest !== undefined && ast.elements.length === 0) {
      const elementType = emitNode(firstRest.type, indent, depth)
      // `Schema.Array(...)` produces `ReadonlyArray<...>` at the Effect type
      // level — emitting `Array<...>` here would silently widen the consumer
      // type to allow mutation that the schema disallows.
      return `ReadonlyArray<${elementType}>`
    }
    const parts = ast.elements.map((e) => emitNode(e.type, indent, depth))
    return `[${parts.join(', ')}]`
  }

  if (SchemaAST.isTypeLiteral(ast)) {
    const firstIdx = ast.indexSignatures[0]
    if (ast.propertySignatures.length === 0 && firstIdx !== undefined) {
      const keyType = emitNode(firstIdx.parameter, indent, depth)
      const valueType = emitNode(firstIdx.type, indent, depth)
      return `Record<${keyType}, ${valueType}>`
    }
    if (ast.propertySignatures.length === 0) return '{}'
    const pad = indent.repeat(depth + 1)
    const close = indent.repeat(depth)
    const lines = ast.propertySignatures.map((sig) => {
      const key = typeof sig.name === 'string' ? sig.name : String(sig.name)
      const optional = sig.isOptional ? '?' : ''
      const valueType = emitNode(sig.type, indent, depth + 1)
      return `${pad}${JSON.stringify(key)}${optional}: ${valueType}`
    })
    return `{\n${lines.join('\n')}\n${close}}`
  }

  if (SchemaAST.isUnion(ast)) {
    const parts = ast.types.map((t) => emitNode(t, indent, depth))
    return parts.join(' | ')
  }

  return 'unknown'
}
