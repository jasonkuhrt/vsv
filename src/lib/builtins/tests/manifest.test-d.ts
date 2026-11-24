// Type-level tests for the prebuilt builtins catalog — proves the assembled
// `builtinsManifest` is usable as a `When` builder argument and that its
// per-key value domains (boolean / open-enum / closed-literal) flow into the
// builder's key/value inference.

import { describe, expectTypeOf, test } from 'vitest';
import { builtinsManifest } from '#lib/builtins/manifest';
import { When } from '#lib/when/builder';
import type { WhenAst } from '#lib/when/when';

const $ = When(builtinsManifest);

describe('builtinsManifest as a When builder argument', () => {
  test('an OpenEnum key (activeCustomEditorId) type-checks a known member', () => {
    // Acceptance: the canary key/value pair from the spec.
    expectTypeOf(
      $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor'),
    ).toEqualTypeOf<WhenAst>();
  });

  test('editorLangId autocompletes a known member AND stays open to unmodeled values', () => {
    // Known core member — this is an autocomplete suggestion.
    $.eq('editorLangId', 'typescript');
    $.eq('editorLangId', 'markdown');
    // An unmodeled language is still accepted — the OpenEnum authoring domain
    // carries an open-string escape. This is the decisive "open" proof.
    $.eq('editorLangId', 'some-new-lang');
    // The authoring projection is the bare known union widened with the
    // open-string escape — NOT the tagged read struct.
    expectTypeOf<Parameters<typeof $.eq<'editorLangId'>>[1]>().toEqualTypeOf<
      | 'typescript'
      | 'javascript'
      | 'typescriptreact'
      | 'javascriptreact'
      | 'json'
      | 'markdown'
      | 'html'
      | 'css'
      | 'python'
      | 'go'
      | 'rust'
      | 'yaml'
      | 'xml'
      | 'java'
      | 'csharp'
      | 'cpp'
      | 'php'
      | 'ruby'
      | 'swift'
      | 'kotlin'
      | 'shellscript'
      | 'dockerfile'
      | 'plaintext'
      | (string & {})
    >();
    // @ts-expect-error -- the OpenEnum authoring domain is string-only; a number is rejected
    $.eq('editorLangId', 42);
    // @ts-expect-error -- the decoded read struct is not a valid authoring argument
    $.eq('editorLangId', { value: 'typescript' });
  });

  test('a misspelled context key is a compile error', () => {
    // @ts-expect-error -- 'inputFocs' is a typo of the core key 'inputFocus'
    $.is('inputFocs');
  });

  test('an entirely undeclared context key is a compile error', () => {
    // @ts-expect-error -- 'not_a_key' is not a VS Code core context key
    $.is('not_a_key');
  });

  test('the correctly spelled boolean key type-checks', () => {
    expectTypeOf($.is('inputFocus')).toEqualTypeOf<WhenAst>();
  });

  test('eq on a boolean key takes a boolean — not a string', () => {
    $.eq('editorTextFocus', true);
    $.eq('editorTextFocus', false);
    expectTypeOf<
      Parameters<typeof $.eq<'editorTextFocus'>>[1]
    >().toEqualTypeOf<boolean>();
    // @ts-expect-error -- a boolean key rejects a string value
    $.eq('editorTextFocus', 'yes');
  });

  test('eq on a closed-literal key (workbenchState) rejects non-members with no open escape', () => {
    $.eq('workbenchState', 'folder');
    $.eq('workbenchState', 'workspace');
    $.eq('workbenchState', 'empty');
    expectTypeOf<Parameters<typeof $.eq<'workbenchState'>>[1]>().toEqualTypeOf<
      'empty' | 'folder' | 'workspace'
    >();
    // @ts-expect-error -- closed Literal key: 'nope' is not a member and there is no open-string escape
    $.eq('workbenchState', 'nope');
  });

  test('a numeric key (workspaceFolderCount) supports comparison operators', () => {
    expectTypeOf($.gt('workspaceFolderCount', 1)).toEqualTypeOf<WhenAst>();
    $.gte('activeEditorGroupIndex', 2);
    // @ts-expect-error -- a boolean key is not numeric
    $.gt('inputFocus', 1);
  });

  test('a compound clause over core keys composes', () => {
    expectTypeOf(
      $.and(
        $.or(
          $.eq('activeWebviewPanelId', 'markdown.preview'),
          $.eq('activeCustomEditorId', 'vscode.markdown.preview.editor'),
        ),
        $.not($.is('inputFocus')),
      ),
    ).toEqualTypeOf<WhenAst>();
  });
});
