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

import { describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import {
  Array,
  Config,
  Effect,
  FileSystem,
  Path,
  Schema,
  String,
  flow,
} from 'effect';
import { testEffect } from '../../runtime-test/test-effect.ts';
import { WhenClause } from '../when.ts';
import corpus from './live-keybindings-corpus.json';

const decode = flow(Schema.decodeUnknownEffect(WhenClause), Effect.runSync);
const encode = flow(Schema.encodeEffect(WhenClause), Effect.runSync);

const roundTrip = (clause: string): string => encode(decode(clause));

// ─── JSONC → distinct `when` strings ─────────────────────────────────────

/**
 * @description Strip JSONC comments (`/* … * /` block, `//` line) without
 * mangling `//` or `/*` that appear inside a string literal (regex when-clauses
 * contain `/`).
 */
const stripJsonc = (raw: string): string => {
  let out = '';
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === undefined) continue;
    const next = raw[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLine = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlock = true;
      i++;
      continue;
    }
    out += c;
  }
  return out;
};

const Keybindings = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ when: Schema.optional(Schema.String) })),
);

const distinctWhenClauses = (jsoncText: string) =>
  Schema.decodeEffect(Keybindings)(stripJsonc(jsoncText)).pipe(
    Effect.map((entries) => [
      ...new Set(
        Array.flatMap(entries, (entry) =>
          entry.when !== undefined && String.trim(entry.when) !== ''
            ? [entry.when]
            : [],
        ),
      ),
    ]),
  );

describe('acceptance — committed live-keybindings corpus round-trips byte-exact', () => {
  test('corpus is non-empty', () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const clause of corpus) {
    test(`byte-exact: ${clause}`, () => {
      expect(roundTrip(clause)).toBe(clause);
    });
  }
});

// ─── 2. The actual live file — proves the corpus is current (when present) ─

describe("acceptance — user's LIVE keybindings.json round-trips byte-exact", () => {
  testEffect(
    'every live clause round-trips and the corpus matches when explicitly required',
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const requireLive =
        (yield* Config.String('VSV_REQUIRE_LIVE_KEYBINDINGS').pipe(
          Config.withDefault(''),
        )) === '1';
      const home = yield* Config.String('HOME').pipe(Config.withDefault(''));
      const live = path.join(
        home,
        'Library',
        'Application Support',
        'Code',
        'User',
        'keybindings.json',
      );
      const exists = home !== '' && (yield* fs.exists(live));
      if (requireLive) expect(exists).toBe(true);
      if (!exists) return;

      const raw = yield* fs.readFileString(live);
      const distinct = yield* distinctWhenClauses(raw);
      const failures = Array.filter(
        distinct,
        (clause) => roundTrip(clause) !== clause,
      );
      expect(
        Array.map(failures, (clause) => [clause, roundTrip(clause)]),
      ).toEqual([]);
      if (requireLive) {
        expect(distinct.length).toBeGreaterThan(0);
        expect([...distinct].sort()).toEqual([...corpus].sort());
      }
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
