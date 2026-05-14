// Runtime validator for "this value is an Effect Schema."
//
// Manifest declaration fields that carry a schema (value domains, command
// args, command results, configuration value shapes, state value shapes)
// validate against this. Replaces the historical `Schema.Unknown` field
// type that accepted any value at runtime, even non-schemas.
//
// Constrained to `Schema.Schema.AnyNoContext` (= `Schema<any, any, never>`):
// manifest decls may not declare schemas that require services to decode or
// encode, because the codegen pipeline and the runtime `defineCommand` /
// `executeCommand` both run outside any layer scope.
//
// Lives in `src/lib/schema/` rather than `src/lib/manifest/` because more
// than one downstream module (manifest decls, when-clause builder, future
// codegen helpers) needs this primitive.

import { Schema } from 'effect'

/**
 * Effect Schema for "an Effect Schema with no service requirements."
 *
 * @example
 * ```ts
 * import { Schema } from 'effect'
 * import { AnySchema } from '#lib/schema/any-schema'
 *
 * // Validates that the value is a Schema:
 * Schema.decodeUnknownSync(AnySchema)(Schema.Boolean)        // ok
 * Schema.decodeUnknownSync(AnySchema)(Schema.Literal('a'))   // ok
 * Schema.decodeUnknownSync(AnySchema)(42)                    // throws
 * Schema.decodeUnknownSync(AnySchema)('not a schema')        // throws
 * ```
 */
// Cast collapses Schema.declare's full inferred type (which references
// Effect-internal symbols like `TypeId` on the resulting `Declaration`
// schema) to the public `Schema.Schema<...>` type. Without this, any
// TaggedClass field typed as `AnySchema` leaks the private symbols into
// its inferred surface and breaks downstream declaration emit
// (TS4020: 'extends' clause has or is using private name).
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- collapses Effect-internal Declaration shape to public Schema type for declaration-emit safety
export const AnySchema = Schema.declare(
  (u: unknown): u is Schema.Schema.AnyNoContext => Schema.isSchema(u),
  {
    identifier: 'AnySchema',
    description: 'An Effect Schema with no service requirements',
  },
) as Schema.Schema<Schema.Schema.AnyNoContext>
