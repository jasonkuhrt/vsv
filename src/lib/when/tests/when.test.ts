import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  WhenAnd,
  type WhenAst,
  WhenAstStruct,
  WhenBoolKey,
  WhenClause,
  WhenCmp,
  WhenEq,
  WhenIn,
  WhenMatch,
  WhenNeq,
  WhenNot,
  WhenOr,
  WhenUnsafeRaw,
} from '../when.ts'

const decode = Schema.decodeUnknownSync(WhenClause)
const encode = Schema.encodeSync(WhenClause)

const decodeStruct = Schema.decodeUnknownSync(WhenAstStruct)
const encodeStruct = Schema.encodeSync(WhenAstStruct)

// ─── Atom: WhenBoolKey ───────────────────────────────────────────────────

describe('WhenBoolKey', () => {
  test('decode bare identifier', () => {
    expect(decode('editorTextFocus')).toEqual(WhenBoolKey.make({ key: 'editorTextFocus' }))
  })

  test('decode tolerates surrounding whitespace', () => {
    expect(decode('   editorTextFocus   ')).toEqual(WhenBoolKey.make({ key: 'editorTextFocus' }))
  })

  test('decode allows dotted identifiers', () => {
    expect(decode('foo.bar.baz')).toEqual(WhenBoolKey.make({ key: 'foo.bar.baz' }))
  })

  test('encode emits the bare key', () => {
    expect(encode(WhenBoolKey.make({ key: 'editorTextFocus' }))).toBe('editorTextFocus')
  })

  test('falls through to UnsafeRaw when identifier starts with digit', () => {
    // Bare-key regex requires leading letter/underscore; digits leak to UnsafeRaw.
    const ast = decode('1bad')
    expect(ast._tag).toBe('WhenUnsafeRaw')
  })
})

// ─── Atom: WhenEq ────────────────────────────────────────────────────────

describe('WhenEq', () => {
  test('decode with string literal value', () => {
    expect(decode("editorLangId == 'markdown'")).toEqual(
      WhenEq.make({ key: 'editorLangId', value: 'markdown' }),
    )
  })

  test('decode with integer value', () => {
    expect(decode('groupActiveEditorCount == 1')).toEqual(
      WhenEq.make({ key: 'groupActiveEditorCount', value: 1 }),
    )
  })

  test('decode with negative number value', () => {
    expect(decode('foo == -3.5')).toEqual(WhenEq.make({ key: 'foo', value: -3.5 }))
  })

  test('decode with true value', () => {
    expect(decode('foo == true')).toEqual(WhenEq.make({ key: 'foo', value: true }))
  })

  test('decode with false value', () => {
    expect(decode('foo == false')).toEqual(WhenEq.make({ key: 'foo', value: false }))
  })

  test('encode string', () => {
    expect(encode(WhenEq.make({ key: 'editorLangId', value: 'markdown' }))).toBe(
      "editorLangId == 'markdown'",
    )
  })

  test('encode number', () => {
    expect(encode(WhenEq.make({ key: 'count', value: 7 }))).toBe('count == 7')
  })

  test('encode boolean', () => {
    expect(encode(WhenEq.make({ key: 'flag', value: true }))).toBe('flag == true')
    expect(encode(WhenEq.make({ key: 'flag', value: false }))).toBe('flag == false')
  })
})

// ─── Atom: WhenNeq ───────────────────────────────────────────────────────

describe('WhenNeq', () => {
  test('decode with string value', () => {
    expect(decode("editorLangId != 'plaintext'")).toEqual(
      WhenNeq.make({ key: 'editorLangId', value: 'plaintext' }),
    )
  })

  test('encode string', () => {
    expect(encode(WhenNeq.make({ key: 'editorLangId', value: 'plaintext' }))).toBe(
      "editorLangId != 'plaintext'",
    )
  })
})

// ─── Atom: WhenMatch ─────────────────────────────────────────────────────

describe('WhenMatch', () => {
  test('decode with no flags', () => {
    expect(decode('editorLangId =~ /^(markdown|prompt)$/')).toEqual(
      WhenMatch.make({ key: 'editorLangId', pattern: '^(markdown|prompt)$' }),
    )
  })

  test('decode with flags', () => {
    expect(decode('foo =~ /bar/i')).toEqual(
      WhenMatch.make({ key: 'foo', pattern: 'bar', flags: 'i' }),
    )
  })

  test('encode with no flags', () => {
    expect(encode(WhenMatch.make({ key: 'editorLangId', pattern: '^(markdown|prompt)$' }))).toBe(
      'editorLangId =~ /^(markdown|prompt)$/',
    )
  })

  test('encode with flags', () => {
    expect(encode(WhenMatch.make({ key: 'foo', pattern: 'bar', flags: 'gi' }))).toBe(
      'foo =~ /bar/gi',
    )
  })
})

// ─── Atom: WhenIn ────────────────────────────────────────────────────────

describe('WhenIn', () => {
  test('decode', () => {
    expect(decode('key in someSet')).toEqual(WhenIn.make({ key: 'key', set: 'someSet' }))
  })

  test('encode', () => {
    expect(encode(WhenIn.make({ key: 'key', set: 'someSet' }))).toBe('key in someSet')
  })
})

// ─── Atom: WhenCmp ───────────────────────────────────────────────────────

describe('WhenCmp', () => {
  test('decode each operator', () => {
    expect(decode('count < 5')).toEqual(WhenCmp.make({ key: 'count', op: '<', value: 5 }))
    expect(decode('count <= 5')).toEqual(WhenCmp.make({ key: 'count', op: '<=', value: 5 }))
    expect(decode('count > 5')).toEqual(WhenCmp.make({ key: 'count', op: '>', value: 5 }))
    expect(decode('count >= 5')).toEqual(WhenCmp.make({ key: 'count', op: '>=', value: 5 }))
  })

  test('decode with float value', () => {
    expect(decode('ratio > 0.5')).toEqual(WhenCmp.make({ key: 'ratio', op: '>', value: 0.5 }))
  })

  test('decode with negative value', () => {
    expect(decode('delta >= -1')).toEqual(WhenCmp.make({ key: 'delta', op: '>=', value: -1 }))
  })

  test('encode', () => {
    expect(encode(WhenCmp.make({ key: 'count', op: '>=', value: 3 }))).toBe('count >= 3')
  })
})

// ─── Combinator: WhenNot ─────────────────────────────────────────────────

describe('WhenNot', () => {
  test('decode without inner parens', () => {
    expect(decode('!inputFocus')).toEqual(
      WhenNot.make({ inner: WhenBoolKey.make({ key: 'inputFocus' }) }),
    )
  })

  test('decode with inner parens', () => {
    expect(decode('!(inputFocus)')).toEqual(
      WhenNot.make({ inner: WhenBoolKey.make({ key: 'inputFocus' }) }),
    )
  })

  test('decode over compound inner', () => {
    expect(decode('!(a && b)')).toEqual(
      WhenNot.make({
        inner: WhenAnd.make({
          terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
        }),
      }),
    )
  })

  test('encode emits !(...)', () => {
    const ast = WhenNot.make({ inner: WhenBoolKey.make({ key: 'inputFocus' }) })
    expect(encode(ast)).toBe('!(inputFocus)')
  })
})

// ─── Combinator: WhenAnd ─────────────────────────────────────────────────

describe('WhenAnd', () => {
  test('decode two terms', () => {
    expect(decode('a && b')).toEqual(
      WhenAnd.make({
        terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
      }),
    )
  })

  test('decode three terms', () => {
    expect(decode('a && b && c')).toEqual(
      WhenAnd.make({
        terms: [
          WhenBoolKey.make({ key: 'a' }),
          WhenBoolKey.make({ key: 'b' }),
          WhenBoolKey.make({ key: 'c' }),
        ],
      }),
    )
  })

  test('decode with parenthesized children', () => {
    expect(decode('(a == 1) && (b == 2)')).toEqual(
      WhenAnd.make({
        terms: [WhenEq.make({ key: 'a', value: 1 }), WhenEq.make({ key: 'b', value: 2 })],
      }),
    )
  })

  test('encode produces fully-parenthesized canonical form', () => {
    const ast = WhenAnd.make({
      terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
    })
    expect(encode(ast)).toBe('(a) && (b)')
  })
})

// ─── Combinator: WhenOr ──────────────────────────────────────────────────

describe('WhenOr', () => {
  test('decode two terms', () => {
    expect(decode('a || b')).toEqual(
      WhenOr.make({
        terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
      }),
    )
  })

  test('Or binds looser than And (a && b || c => Or(And(a,b), c))', () => {
    expect(decode('a && b || c')).toEqual(
      WhenOr.make({
        terms: [
          WhenAnd.make({
            terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
          }),
          WhenBoolKey.make({ key: 'c' }),
        ],
      }),
    )
  })

  test('encode produces fully-parenthesized canonical form', () => {
    const ast = WhenOr.make({
      terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
    })
    expect(encode(ast)).toBe('(a) || (b)')
  })
})

// ─── Fallback: WhenUnsafeRaw ─────────────────────────────────────────────

describe('WhenUnsafeRaw', () => {
  test('absorbs unparseable text', () => {
    const ast = decode('totally $weird @input')
    expect(ast._tag).toBe('WhenUnsafeRaw')
    expect((ast as WhenUnsafeRaw).text).toBe('totally $weird @input')
  })

  test('encode emits the stored text verbatim', () => {
    expect(encode(WhenUnsafeRaw.make({ text: 'arbitrary clause' }))).toBe('arbitrary clause')
  })

  test('empty / whitespace-only input fails the entire union', () => {
    expect(() => decode('')).toThrow()
    expect(() => decode('   ')).toThrow()
  })
})

// ─── Real-world end-to-end ───────────────────────────────────────────────

describe('end-to-end: VS Code preview gate', () => {
  const input =
    "(activeCustomEditorId == 'vscode.markdown.preview.editor' || activeWebviewPanelId == 'markdown.preview') && !inputFocus"

  test('decodes the markdown preview gate', () => {
    const ast = decode(input)
    expect(ast).toEqual(
      WhenAnd.make({
        terms: [
          WhenOr.make({
            terms: [
              WhenEq.make({
                key: 'activeCustomEditorId',
                value: 'vscode.markdown.preview.editor',
              }),
              WhenEq.make({ key: 'activeWebviewPanelId', value: 'markdown.preview' }),
            ],
          }),
          WhenNot.make({ inner: WhenBoolKey.make({ key: 'inputFocus' }) }),
        ],
      }),
    )
  })

  test('canonical re-encode is structurally identical on second round-trip', () => {
    const ast1 = decode(input)
    const text1 = encode(ast1)
    const ast2 = decode(text1)
    const text2 = encode(ast2)
    expect(text2).toBe(text1)
    expect(ast2).toEqual(ast1)
  })
})

// ─── Round-trip property check across every variant ──────────────────────

describe('round-trip: encode then decode preserves structure', () => {
  const cases: ReadonlyArray<readonly [string, WhenAst]> = [
    ['BoolKey', WhenBoolKey.make({ key: 'editorTextFocus' })],
    ['Eq string', WhenEq.make({ key: 'editorLangId', value: 'markdown' })],
    ['Eq number', WhenEq.make({ key: 'count', value: 42 })],
    ['Eq boolean', WhenEq.make({ key: 'flag', value: true })],
    ['Neq', WhenNeq.make({ key: 'foo', value: 'bar' })],
    ['Match no flags', WhenMatch.make({ key: 'lang', pattern: 'md|tx' })],
    ['Match with flags', WhenMatch.make({ key: 'lang', pattern: 'foo', flags: 'i' })],
    ['In', WhenIn.make({ key: 'k', set: 's' })],
    ['Cmp <', WhenCmp.make({ key: 'n', op: '<', value: 1 })],
    ['Cmp <=', WhenCmp.make({ key: 'n', op: '<=', value: 1 })],
    ['Cmp >', WhenCmp.make({ key: 'n', op: '>', value: 1 })],
    ['Cmp >=', WhenCmp.make({ key: 'n', op: '>=', value: 1 })],
    ['Not(BoolKey)', WhenNot.make({ inner: WhenBoolKey.make({ key: 'x' }) })],
    [
      'And(BoolKey, BoolKey)',
      WhenAnd.make({
        terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
      }),
    ],
    [
      'Or(BoolKey, BoolKey)',
      WhenOr.make({
        terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
      }),
    ],
    [
      'Nested Not(And(Or(Eq, Eq), BoolKey))',
      WhenNot.make({
        inner: WhenAnd.make({
          terms: [
            WhenOr.make({
              terms: [WhenEq.make({ key: 'a', value: 1 }), WhenEq.make({ key: 'b', value: 'x' })],
            }),
            WhenBoolKey.make({ key: 'c' }),
          ],
        }),
      }),
    ],
    ['UnsafeRaw', WhenUnsafeRaw.make({ text: 'totally $weird @input' })],
  ]
  for (const [name, ast] of cases) {
    test(name, () => {
      const text = encode(ast)
      const back = decode(text)
      expect(back).toEqual(ast)
    })
  }
})

// ─── Structural codec (WhenAstStruct) ────────────────────────────────────

describe('WhenAstStruct', () => {
  test('decodes a tagged-struct shape directly', () => {
    const raw = {
      _tag: 'WhenAnd',
      terms: [
        { _tag: 'WhenBoolKey', key: 'a' },
        { _tag: 'WhenBoolKey', key: 'b' },
      ],
    }
    const ast = decodeStruct(raw)
    expect(ast).toEqual(
      WhenAnd.make({
        terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
      }),
    )
  })

  test('encodes back to tagged-struct shape', () => {
    const ast = WhenAnd.make({
      terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
    })
    expect(encodeStruct(ast)).toEqual({
      _tag: 'WhenAnd',
      terms: [
        { _tag: 'WhenBoolKey', key: 'a' },
        { _tag: 'WhenBoolKey', key: 'b' },
      ],
    })
  })

  test('rejects an unknown _tag', () => {
    expect(() => decodeStruct({ _tag: 'Nope' })).toThrow()
  })

  // Exercise each TaggedClass's `Schema.suspend(...)` recursive field through
  // the struct codec so every suspend thunk fires at least once.
  test('round-trips WhenNot through the struct codec', () => {
    const ast = WhenNot.make({ inner: WhenBoolKey.make({ key: 'x' }) })
    expect(decodeStruct(encodeStruct(ast))).toEqual(ast)
  })

  test('round-trips WhenOr through the struct codec', () => {
    const ast = WhenOr.make({
      terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
    })
    expect(decodeStruct(encodeStruct(ast))).toEqual(ast)
  })

  test('round-trips every atom variant through the struct codec', () => {
    const atoms: ReadonlyArray<WhenAst> = [
      WhenBoolKey.make({ key: 'k' }),
      WhenEq.make({ key: 'k', value: 'v' }),
      WhenNeq.make({ key: 'k', value: 1 }),
      WhenMatch.make({ key: 'k', pattern: 'p', flags: 'i' }),
      WhenIn.make({ key: 'k', set: 's' }),
      WhenCmp.make({ key: 'k', op: '>=', value: 3 }),
      WhenUnsafeRaw.make({ text: 'raw' }),
    ]
    for (const ast of atoms) {
      expect(decodeStruct(encodeStruct(ast))).toEqual(ast)
    }
  })

  test('round-trips deeply nested Not(And(Or(...))) through struct codec', () => {
    const ast = WhenNot.make({
      inner: WhenAnd.make({
        terms: [
          WhenOr.make({
            terms: [WhenBoolKey.make({ key: 'a' }), WhenBoolKey.make({ key: 'b' })],
          }),
          WhenBoolKey.make({ key: 'c' }),
        ],
      }),
    })
    expect(decodeStruct(encodeStruct(ast))).toEqual(ast)
  })
})
