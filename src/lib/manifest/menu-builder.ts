// Typed `Menu` authoring builder. Produces `MenuDecl` nodes from a
// manifest-typed surface — the `command` id is constrained to the manifest's
// declared command universe (owned `commands` + consumed `externalCommands`),
// so a typo'd or undeclared command id is a compile error. Symmetric to the
// `When(manifest)` builder for context keys.
//
// The `when` field is a `WhenAst`, built via the companion `When(manifest)`
// surface; the menu builder does not re-implement clause typing — it composes
// with the existing AST.

import type { WhenAst } from '#lib/when/when';
import type { CommandDecl } from './decls/command.ts';
import type { ExternalCommandDecl } from './decls/external-command.ts';
import { MenuDecl } from './decls/menu.ts';
import type { TypedManifest } from './define.ts';

/**
 * @description Union of command ids declared by a typed manifest, across both
 * owned (`commands`) and consumed (`externalCommands`) decl arrays. Resolves to
 * `never` when no commands are declared, so any menu entry that references a
 * command on a command-less manifest is a compile error.
 */
export type CommandId<M> =
  M extends TypedManifest<infer Spec>
    ?
        | (Spec['commands'] extends ReadonlyArray<infer D>
            ? D extends CommandDecl
              ? D['id']
              : never
            : never)
        | (Spec['externalCommands'] extends ReadonlyArray<infer D>
            ? D extends ExternalCommandDecl
              ? D['id']
              : never
            : never)
    : never;

/**
 * @description The typed `Menu` builder produced by `Menu(manifest)`. The
 * single `entry` method narrows `command` to the manifest's declared command-id
 * universe and captures the `location` literal, returning a `MenuDecl` ready to
 * place in the manifest's `menus` array.
 */
export interface MenuBuilder<M> {
  /**
   * @description Declare a menu entry. `command` is narrowed to a declared
   * command id; `location` is the menu contribution point key; `when` is an
   * optional `WhenAst` (build it with `When(manifest)`); `group` is an optional
   * ordering hint.
   */
  readonly entry: <
    const Loc extends string,
    const Cmd extends CommandId<M> & string,
  >(spec: {
    readonly location: Loc;
    readonly command: Cmd;
    readonly when?: WhenAst;
    readonly group?: string;
  }) => MenuDecl<Loc, Cmd>;
}

/**
 * @description Construct a manifest-typed `Menu` builder. The manifest's
 * declared commands (owned + external) constrain `entry({ command })` to legal
 * command ids.
 *
 * @example
 *   ```ts
 *   import {
 *     defineManifest,
 *     CommandDecl,
 *     Menu,
 *   } from '@jasonkuhrt/vsv/manifest';
 *   import { When } from '@jasonkuhrt/vsv/when';
 *   import { Schema } from 'effect';
 *
 *   const manifest = defineManifest({
 *     name: 'ext',
 *     publisher: 'jasonkuhrt',
 *     commands: [
 *       CommandDecl({
 *         id: 'ext.delete',
 *         args: Schema.Void,
 *         result: Schema.Void,
 *       }),
 *     ],
 *     externalContextKeys: [
 *       ExternalContextKeyDecl({
 *         name: 'explorerResourceIsFolder',
 *         valueType: Schema.Boolean,
 *       }),
 *     ],
 *   });
 *
 *   const $ = When(manifest);
 *   const menu = Menu(manifest);
 *   const decl = menu.entry({
 *     location: 'explorer/context',
 *     command: 'ext.delete',
 *     when: $.is('explorerResourceIsFolder'),
 *     group: 'navigation',
 *   });
 *   ```;
 */
export const Menu = <
  M extends TypedManifest<{
    readonly name: string;
    readonly publisher: string;
  }>,
>(
  _manifest: M,
): MenuBuilder<M> => ({
  entry: (spec) =>
    MenuDecl({
      location: spec.location,
      command: spec.command,
      ...(spec.when !== undefined ? { when: spec.when } : {}),
      ...(spec.group !== undefined ? { group: spec.group } : {}),
    }),
});
