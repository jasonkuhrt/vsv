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

import { Record, Schema } from 'effect'
import type { SchemaAST } from 'effect'

type EnumMembers = Record<string, string>

type ClosedEnumMembers<Members extends EnumMembers> = {
  [K in keyof Members as Members[K] extends 'unknown' ? never : K]: Members[K]
}

type ClosedValue<Members extends EnumMembers> =
  ClosedEnumMembers<Members>[keyof ClosedEnumMembers<Members>] & string

type TypeKnownValue<Members extends EnumMembers> = {
  readonly value: ClosedValue<Members>
}

type TypeUnknownValue = {
  readonly found: string
  readonly value: 'unknown'
}

type TypeValue<Members extends EnumMembers> = TypeKnownValue<Members> | TypeUnknownValue

type MakeFromReturn<Members extends EnumMembers, Value extends string> = string extends Value
  ? TypeValue<Members>
  : Value extends ClosedValue<Members>
    ? { readonly value: Value }
    : TypeUnknownValue

// Inlined from heartbeat's `SchemaFn.WithIs`/`SchemaFn.Is` (effect-plus). `is`
// mirrors the signature of `Schema.is`'s returned guard (re-exported from
// ParseResult): `(value, overrideOptions?: ParseOptions | number) => value is Type<S>`.
type Is<S extends Schema.Schema.AnyNoContext> = (
  value: unknown,
  overrideOptions?: SchemaAST.ParseOptions | number,
) => value is Schema.Schema.Type<S>

type SchemaWithIs<S extends Schema.Schema.AnyNoContext> = S & {
  readonly is: Is<S>
}

// Membership test that narrows an arbitrary string to the closed-member value
// union. The single cast lives here (the runtime `includes` check is the
// evidence the type system can't follow), so call sites stay cast-free.
function isClosedValueIn<Members extends EnumMembers>(
  closedMembers: ClosedEnumMembers<Members>,
  value: string,
): value is ClosedValue<Members> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Record.values widens to string[]; the includes() result is the narrowing evidence.
  return (Record.values(closedMembers) as ReadonlyArray<string>).includes(value)
}

function withIs<S extends Schema.Schema.AnyNoContext>(schema: S): SchemaWithIs<S> {
  return Object.assign(schema, {
    is: Schema.is(schema),
  })
}

export function OpenEnum<const Members extends EnumMembers>(_identifier: string, members: Members) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- filter preserves the non-'unknown' members exactly as ClosedEnumMembers.
  const closedMembers = Record.filter(
    members,
    (value) => value !== 'unknown',
  ) as ClosedEnumMembers<Members>

  const Closed = withIs(Schema.Enums(closedMembers))
  const Open = withIs(Schema.Enums(members))

  const KnownBase = Schema.Struct({
    value: Closed,
  })
  const Known = Object.assign(KnownBase, {
    fromValue<Value extends ClosedValue<Members>>(value: Value) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrows the struct make result to the literal-valued known shape.
      return KnownBase.make({
        value,
      }) as { readonly value: Value }
    },
    is: Schema.is(KnownBase),
  })

  const UnknownBase = Schema.Struct({
    found: Schema.String,
    value: Schema.Literal('unknown'),
  })
  const Unknown = Object.assign(UnknownBase, {
    fromValue(found: string) {
      return UnknownBase.make({
        found,
        value: 'unknown',
      })
    },
    is: Schema.is(UnknownBase),
  })

  const schema = Schema.Union(Known, Unknown)

  return Object.assign(schema, members, {
    Closed,
    is: Schema.is(schema),
    Known,
    makeFrom<Value extends string>(value: Value): MakeFromReturn<Members, Value> {
      // The guard narrows `value` to ClosedValue<Members> in the known branch,
      // so each arm is cast-free; only the value-dependent union return needs
      // a cast (TS can't relate the runtime dispatch to the conditional type).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrows the dispatched arm to the conditional MakeFromReturn for `value`.
      return (
        isClosedValueIn(closedMembers, value) ? Known.fromValue(value) : Unknown.fromValue(value)
      ) as MakeFromReturn<Members, Value>
    },
    Open,
    Unknown,
  })
}

export namespace OpenEnum {
  export type Any = Schema.Schema.AnyNoContext & {
    readonly Closed: Schema.Schema.AnyNoContext
    readonly Known: Schema.Schema.AnyNoContext
    readonly Open: Schema.Schema.AnyNoContext
    readonly Unknown: Schema.Schema.AnyNoContext
  }

  export type Type<T extends Any> = Schema.Schema.Type<T>
  export type TypeKnown<T extends Any> = Schema.Schema.Type<T['Known']>
  export type TypeUnknown<T extends Any> = Schema.Schema.Type<T['Unknown']>
  export type TypeClosed<T extends Any> = Schema.Schema.Type<T['Closed']>
  export type TypeOpen<T extends Any> = Schema.Schema.Type<T['Open']>
}
