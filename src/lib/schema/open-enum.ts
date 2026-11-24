// TODO: upstream to @kitz/sch — generic schema combinator, not VS Code knowledge.
//
// OpenEnum — a tagged, parse-don't-validate combinator over a known set of
// string members that stays open to unrecognized runtime values.
//
// `OpenEnum(identifier, members)` builds a schema whose decoded type is a
// tagged union: a known value decodes to `{ value }`, an unrecognized value
// decodes to `{ found, value: 'unknown' }`. It never rejects — the raw string
// is preserved on the `found` field — so it models VS Code context-key value
// domains that have a known core membership but are extensible at runtime
// (e.g. `editorLangId`, `resourceExtname`, view/panel ids).
//
// Imports only `effect` (Record, Schema) so it lands in vsv's pure library
// subset and the Phase-A purity guard covers it.

import { Record, Schema } from 'effect';

type EnumMembers = Record<string, string>;

type ClosedEnumMembers<Members extends EnumMembers> = {
  [K in keyof Members as Members[K] extends 'unknown' ? never : K]: Members[K];
};

type ClosedValue<Members extends EnumMembers> =
  ClosedEnumMembers<Members>[keyof ClosedEnumMembers<Members>] & string;

interface TypeKnownValue<Members extends EnumMembers> {
  readonly value: ClosedValue<Members>;
}

interface TypeUnknownValue {
  readonly found: string;
  readonly value: 'unknown';
}

export type TypeValue<Members extends EnumMembers> =
  | TypeKnownValue<Members>
  | TypeUnknownValue;

export type MakeFromReturn<
  Members extends EnumMembers,
  Value extends string,
> = string extends Value
  ? TypeValue<Members>
  : Value extends ClosedValue<Members>
    ? { readonly value: Value }
    : TypeUnknownValue;

type SchemaWithIs<S extends Schema.ConstraintCodec<unknown, unknown>> = S & {
  readonly is: <Input>(input: Input) => input is Input & S['Type'];
};

function withIs<S extends Schema.ConstraintCodec<unknown, unknown>>(
  schema: S,
): SchemaWithIs<S> {
  return Object.assign(schema, {
    is: Schema.is(schema),
  });
}

export function OpenEnum<const Members extends EnumMembers>(
  _identifier: string,
  members: Members,
) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- filter preserves the non-'unknown' members exactly as ClosedEnumMembers.
  const closedMembers = Record.filter(
    members,
    (value) => value !== 'unknown',
  ) as ClosedEnumMembers<Members>;

  const Closed = withIs(Schema.Enum(closedMembers));
  const Open = withIs(Schema.Enum(members));

  const KnownBase = Schema.Struct({
    value: Closed,
  });
  const Known = Object.assign(KnownBase, {
    fromValue<Value extends ClosedValue<Members>>(value: Value) {
      return Object.assign(KnownBase.make({ value }), { value });
    },
    is: Schema.is(KnownBase),
  });

  const UnknownBase = Schema.Struct({
    found: Schema.String,
    value: Schema.Literal('unknown'),
  });
  const Unknown = Object.assign(UnknownBase, {
    fromValue(found: string) {
      return UnknownBase.make({
        found,
        value: 'unknown',
      });
    },
    is: Schema.is(UnknownBase),
  });

  function makeFrom<Value extends string>(
    value: Value,
  ): MakeFromReturn<Members, Value>;
  function makeFrom(value: string): TypeValue<Members> {
    return Closed.is(value) ? Known.fromValue(value) : Unknown.fromValue(value);
  }

  const schema = Schema.Union([Known, Unknown]);

  return Object.assign(schema, members, {
    Closed,
    is: Schema.is(schema),
    Known,
    makeFrom,
    Open,
    Unknown,
  });
}

export namespace OpenEnum {
  export type Any = Schema.ConstraintCodec<unknown, unknown> & {
    readonly Closed: Schema.ConstraintCodec<unknown, unknown>;
    readonly Known: Schema.ConstraintCodec<unknown, unknown>;
    readonly Open: Schema.ConstraintCodec<unknown, unknown>;
    readonly Unknown: Schema.ConstraintCodec<unknown, unknown>;
  };

  export type Type<T extends Any> = T['Type'];
  export type TypeKnown<T extends Any> = T['Known']['Type'];
  export type TypeUnknown<T extends Any> = T['Unknown']['Type'];
  export type TypeClosed<T extends Any> = T['Closed']['Type'];
  export type TypeOpen<T extends Any> = T['Open']['Type'];
}
