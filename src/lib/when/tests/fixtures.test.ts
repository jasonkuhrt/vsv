// Fixture-driven decode tests — real `when`-clauses harvested from VS Code's
// own bundled extensions (`extensions/*/package.json` in the VS Code repo).
//
// The bar for each fixture: it must decode to a *typed* variant tree (never
// bare `WhenUnsafeRaw`), and `decode → encode → decode` must be a fixpoint.
// A fixture landing in `WhenUnsafeRaw` is a grammar hole — the corpus is the
// regression fence that keeps the holes closed.

import { describe, expect, test } from 'bun:test';
import { Effect, flow, Array, Schema } from 'effect';
import {
  type WhenAst,
  WhenAnd,
  WhenBoolKey,
  WhenClause,
  WhenCmp,
  WhenEq,
  WhenIn,
  WhenMatch,
  WhenNot,
  WhenOr,
} from '../when.ts';

const decode = flow(Schema.decodeUnknownEffect(WhenClause), Effect.runSync);
const encode = flow(Schema.encodeEffect(WhenClause), Effect.runSync);

// Every node in the tree — does any of them carry the `WhenUnsafeRaw` tag?
const hasUnsafeRaw = (ast: WhenAst): boolean =>
  ast._tag === 'WhenUnsafeRaw' ||
  (ast._tag === 'WhenNot' && hasUnsafeRaw(ast.inner)) ||
  ((ast._tag === 'WhenAnd' || ast._tag === 'WhenOr') &&
    Array.some(ast.terms, hasUnsafeRaw));

// Real clauses, grouped by the grammar feature they exercise. Each is a
// verbatim string from a VS Code bundled extension's `package.json`.
const corpus: ReadonlyArray<readonly [string, string]> = [
  // — bare-word RHS (`key == identifier`, no quotes) —
  ['bare-word RHS', 'chatSessionType == claude-code'],
  [
    'bare-word RHS, dotted',
    'activeEditor == workbench.editors.files.textFileEditor',
  ],
  ['bare-word RHS, short', 'scmProvider == git'],
  // — hyphenated identifiers —
  ['hyphenated key', 'github.copilot-chat.activated'],
  ['hyphenated RHS', 'chatCustomizationSessionType == claude-code'],
  // — `in` clauses —
  ['in-clause, dotted set', 'resource in git.mergeChanges'],
  ['in-clause, dotted both', 'mergeEditorResultUri in git.mergeChanges'],
  // — numeric comparison —
  ['comparison >', 'git.closedRepositoryCount > 1'],
  ['comparison, dotted key', 'github.copilot.chat.review.numberOfComments > 1'],
  // — regex match —
  [
    'regex match',
    'resourceLangId =~ /^(markdown|prompt|instructions|chatagent|skill)$/',
  ],
  ['regex match with colon', 'mergeEditorBaseUri =~ /^(git|file):/'],
  // — quoted-string equality —
  ['quoted == ', "activeCustomEditorId == 'vscode.markdown.preview.editor'"],
  // — `!=` with number —
  ['neq number', 'mergeConflictsCount != 0'],
  // — compound: !, &&, ||, parens, mixed atoms —
  [
    'compound merge gate',
    'config.git.enabled && !git.missing && !isInDiffEditor && !isMergeEditor && resource in git.mergeChanges && git.activeResourceHasMergeConflicts',
  ],
  [
    'compound with parens + or',
    "(activeWebviewPanelId == 'markdown.preview' || activeCustomEditorId == 'vscode.markdown.preview.editor') && !inputFocus",
  ],
  [
    'compound with bare-word disjunction',
    'chatSessionType == copilotcli && isSessionsWindow && (sessions.changesVersionMode == branchChanges || sessions.changesVersionMode == uncommittedChanges)',
  ],
];

describe('fixture corpus — real VS Code when-clauses', () => {
  for (const [name, clause] of corpus) {
    test(`decodes to a typed tree (no UnsafeRaw): ${name}`, () => {
      const ast = decode(clause);
      expect(hasUnsafeRaw(ast)).toBe(false);
    });

    test(`re-decode is a fixpoint: ${name}`, () => {
      const once = decode(clause);
      expect(decode(encode(once))).toEqual(once);
    });
  }

  // — exact-AST locks for representative shapes —

  test('bare-word RHS decodes to a string-valued WhenEq', () => {
    expect(decode('chatSessionType == claude-code')).toEqual(
      WhenEq.make({ key: 'chatSessionType', value: 'claude-code' }),
    );
  });

  test('hyphenated key decodes to a WhenBoolKey', () => {
    expect(decode('github.copilot-chat.activated')).toEqual(
      WhenBoolKey.make({ key: 'github.copilot-chat.activated' }),
    );
  });

  test('in-clause decodes to a WhenIn with the dotted set', () => {
    expect(decode('resource in git.mergeChanges')).toEqual(
      WhenIn.make({ key: 'resource', set: 'git.mergeChanges' }),
    );
  });

  test('comparison decodes to a WhenCmp', () => {
    expect(decode('git.closedRepositoryCount > 1')).toEqual(
      WhenCmp.make({ key: 'git.closedRepositoryCount', op: '>', value: 1 }),
    );
  });

  test('regex match decodes to a WhenMatch', () => {
    expect(decode('mergeEditorBaseUri =~ /^(git|file):/')).toEqual(
      WhenMatch.make({ key: 'mergeEditorBaseUri', pattern: '^(git|file):' }),
    );
  });

  test('compound parens + or decodes to the expected nesting', () => {
    expect(
      decode(
        "(activeWebviewPanelId == 'markdown.preview' || activeCustomEditorId == 'vscode.markdown.preview.editor') && !inputFocus",
      ),
    ).toEqual(
      WhenAnd.make({
        terms: [
          WhenOr.make({
            terms: [
              WhenEq.make({
                key: 'activeWebviewPanelId',
                value: 'markdown.preview',
              }),
              WhenEq.make({
                key: 'activeCustomEditorId',
                value: 'vscode.markdown.preview.editor',
              }),
            ],
          }),
          WhenNot.make({ inner: WhenBoolKey.make({ key: 'inputFocus' }) }),
        ],
      }),
    );
  });
});
