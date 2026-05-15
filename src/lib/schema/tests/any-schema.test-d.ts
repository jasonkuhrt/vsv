// Type-level test for `AnySchema` — Surface G.
//
// `AnySchema` is the field type every decl uses for its schema-carrying
// slot. Its decoded type must be `Schema.Schema.AnyNoContext` — the
// no-requirements Schema bound the manifest/runtime rely on. (Runtime
// rejection of non-Schema values is behavioral — covered elsewhere.)

import type { Schema } from 'effect'
import { describe, expectTypeOf, test } from 'vitest'
import type { AnySchema } from '#lib/schema/any-schema'

describe('AnySchema', () => {
  test('decoded type is the no-context Schema bound', () => {
    expectTypeOf<Schema.Schema.Type<typeof AnySchema>>().not.toBeAny()
    expectTypeOf<Schema.Schema.Type<typeof AnySchema>>().toEqualTypeOf<Schema.Schema.AnyNoContext>()
  })
})
