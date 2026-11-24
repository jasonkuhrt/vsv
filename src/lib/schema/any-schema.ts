import { Schema } from 'effect';

// Service requirements are erased at runtime. Manifest authors are constrained
// to service-free codecs by the declaration factories' TypeScript signatures.
export const AnySchema = Schema.declare(
  (value: unknown): value is Schema.ConstraintCodec<unknown, unknown> =>
    Schema.isSchema(value),
  {
    identifier: 'AnySchema',
    description: 'An Effect Schema with no service requirements',
  },
);
