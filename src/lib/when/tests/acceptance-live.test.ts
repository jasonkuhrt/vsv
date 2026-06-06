// Acceptance: byte-exact round-trip against the user's LIVE VS Code
// `keybindings.json`.
//
// The clauses VS Code itself writes (and that humans hand-edit in
// `keybindings.json`) are already in the minimal-paren idiomatic form. The
// real proof that vsv's encoder is byte-preserving — that key-binder's canary
// can emit `keybindings.json` without churning every clause — is that
// `decode → encode` returns each live clause UNCHANGED, byte-for-byte.
//
// Two layers, so the proof is both durable and live:
//
//   1. A committed static corpus (`live-keybindings-corpus.json`) — the
//      distinct `when` strings harvested from the live file. This is the
//      permanent CI fence: it round-trips byte-exact on ANY machine, with no
//      dependency on a user's home directory.
//   2. The actual live file, read when present and skipped (not failed) when
//      absent. On the author's machine this re-proves the corpus is current;
//      elsewhere it no-ops. Set VSV_REQUIRE_LIVE_KEYBINDINGS=1 to turn an
//      absent/empty live file into a failure (used when refreshing the corpus).

import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { WhenClause } from '../when.ts'

const decode = Schema.decodeUnknownSync(WhenClause)
const encode = Schema.encodeSync(WhenClause)

const roundTrip = (clause: string): string => encode(decode(clause))

// ─── JSONC → distinct `when` strings ─────────────────────────────────────

/**
 * Strip JSONC comments (`/* … *​/` block, `//` line) without mangling `//` or
 * `/*` that appear inside a string literal (regex when-clauses contain `/`).
 */
const stripJsonc = (raw: string): string => {
  let out = ''
  let inStr = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    const next = raw[i + 1]
    if (inLine) {
      if (c === '\n') {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inStr) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i++
      } else if (c === '"') {
        inStr = false
      }
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    if (c === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (c === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    out += c
  }
  return out
}

interface Keybinding {
  readonly when?: unknown
}

const distinctWhenClauses = (jsoncText: string): ReadonlyArray<string> => {
  const parsed: unknown = JSON.parse(stripJsonc(jsoncText))
  if (!Array.isArray(parsed)) return []
  const clauses = parsed
    .map((entry) => (entry as Keybinding).when)
    .filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
  return [...new Set(clauses)]
}

const liveKeybindingsPath = (): string =>
  Path.join(Os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'keybindings.json')

// ─── 1. Committed corpus — durable byte-exact fence (always runs) ─────────

const corpus: ReadonlyArray<string> = JSON.parse(
  Fs.readFileSync(Path.join(import.meta.dirname, 'live-keybindings-corpus.json'), 'utf8'),
) as ReadonlyArray<string>

describe('acceptance — committed live-keybindings corpus round-trips byte-exact', () => {
  test('corpus is non-empty', () => {
    expect(corpus.length).toBeGreaterThan(0)
  })

  for (const clause of corpus) {
    test(`byte-exact: ${clause}`, () => {
      expect(roundTrip(clause)).toBe(clause)
    })
  }
})

// ─── 2. The actual live file — proves the corpus is current (when present) ─

describe("acceptance — user's LIVE keybindings.json round-trips byte-exact", () => {
  const path = liveKeybindingsPath()
  const exists = Fs.existsSync(path)
  const requireLive = process.env['VSV_REQUIRE_LIVE_KEYBINDINGS'] === '1'

  test('live keybindings.json: every distinct when clause round-trips byte-exact', () => {
    if (!exists) {
      if (requireLive) {
        throw new Error(`VSV_REQUIRE_LIVE_KEYBINDINGS=1 but no file at ${path}`)
      }
      return // no live file on this machine — the committed corpus is the fence
    }

    const distinct = distinctWhenClauses(Fs.readFileSync(path, 'utf8'))
    if (requireLive) {
      expect(distinct.length).toBeGreaterThan(0)
    }

    const failures = distinct.filter((clause) => roundTrip(clause) !== clause)
    expect(failures.map((c) => [c, roundTrip(c)])).toEqual([])
  })

  test('committed corpus matches the live file (keeps the fence current)', () => {
    if (!exists) return
    const distinct = [...distinctWhenClauses(Fs.readFileSync(path, 'utf8'))].sort()
    const committed = [...corpus].sort()
    // If this fails the live file drifted from the committed corpus — refresh
    // `live-keybindings-corpus.json` from the live distinct set.
    expect(distinct).toEqual(committed)
  })
})
