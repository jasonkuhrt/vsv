// Type-level tests for the `WhenClause` codec — Surface F.
//
// The codec's runtime behavior (round-trips, grammar) is covered by
// `when.test.ts` / `property.test.ts`. This file pins the codec's type
// signature: the directions it maps, and `_tag` discrimination of the AST.

import { flow, Effect, Schema } from 'effect';
import { describe, expectTypeOf, test } from 'vitest';
import {
  type WhenAnd,
  type WhenAst,
  type WhenBoolKey,
  WhenClause,
} from '#lib/when/when';

declare const ast: WhenAst;

describe('WhenClause codec', () => {
  test('decodeUnknownSync maps an unknown input to a WhenAst', () => {
    const decode = flow(Schema.decodeUnknownEffect(WhenClause), Effect.runSync);
    expectTypeOf(decode).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(decode).returns.not.toBeAny();
    expectTypeOf(decode).returns.toEqualTypeOf<WhenAst>();
  });

  test('encodeSync maps a WhenAst to a string', () => {
    const encode = flow(Schema.encodeEffect(WhenClause), Effect.runSync);
    expectTypeOf(encode).parameter(0).toEqualTypeOf<WhenAst>();
    expectTypeOf(encode).returns.toEqualTypeOf<string>();
  });
});

describe('WhenAst discrimination', () => {
  test('narrowing on _tag yields the specific variant', () => {
    if (ast._tag === 'WhenAnd') {
      expectTypeOf(ast).toEqualTypeOf<WhenAnd>();
    }
    if (ast._tag === 'WhenBoolKey') {
      expectTypeOf(ast).toEqualTypeOf<WhenBoolKey>();
    }
  });
});
