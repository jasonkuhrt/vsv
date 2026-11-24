import { Schema } from 'effect';
import { NonEmptyTrimmedString } from '#lib/schema/non-empty-trimmed-string';
import { WhenAstStruct } from '#lib/when/when';
import type { WhenAst } from '#lib/when/when';

/**
 * @description Structural schema — what serialization, codegen, and the IR see.
 *
 * The `when` field is the structural `WhenAst` (a `WhenAstStruct` union), NOT a
 * clause string. Codegen serializes it to VS Code's clause syntax via
 * `Schema.encodeSync(WhenClause)` at the `package.json` emit boundary; storing
 * the AST keeps the menu decl in the same parse-don't-validate regime as the
 * rest of the manifest — a malformed clause can never enter a `MenuDecl`.
 */
export class MenuDeclStruct extends Schema.TaggedClass<MenuDeclStruct, {}>()(
  'MenuDecl',
  {
    /**
     * @description The menu contribution point — the key under
     * `contributes.menus` (e.g. `explorer/context`, `editor/title`,
     * `commandPalette`).
     */
    location: NonEmptyTrimmedString,
    /**
     * @description The command id this entry invokes (an owned or external
     * command).
     */
    command: NonEmptyTrimmedString,
    /**
     * @description Optional `when`-clause gating the entry's visibility, as a
     * `WhenAst`.
     */
    when: Schema.optional(WhenAstStruct),
    /**
     * @description Optional sort/group ordering hint (e.g. `navigation`,
     * `1_modification`).
     */
    group: Schema.optional(NonEmptyTrimmedString),
  },
) {}

/**
 * @description Typed authoring shape. Structurally satisfies `MenuDeclStruct`
 * but carries the `command` id and `location` literals at the type level so a
 * manifest-bound `Menu(manifest)` builder can constrain them against the
 * declared command universe.
 */
export type MenuDecl<
  Loc extends string = string,
  Cmd extends string = string,
> = Omit<MenuDeclStruct, 'location' | 'command'> & {
  readonly location: Loc;
  readonly command: Cmd;
};

/**
 * @description Declares a **menu contribution** — a command surfaced in one of
 * VS Code's menu locations, optionally gated by a `when` clause and ordered by
 * a `group`. Emitted to `package.json#contributes.menus` by codegen, with the
 * `when` AST serialized to VS Code's clause syntax.
 *
 * Prefer the manifest-bound `Menu(manifest)` builder for authoring: it narrows
 * `command` to the manifest's declared command-id universe (owned + external)
 * so a typo'd or undeclared command id is a compile error, and lets the `when`
 * be built with the typed `When(manifest)` surface. This bare factory exists
 * for the decl-pattern parity (`.Struct` / `.is`) and for callers that already
 * hold validated ids.
 *
 * ## Fields
 *
 * - `location` — the menu contribution point: the key under `contributes.menus`.
 *   Common values: `explorer/context`, `editor/title`, `editor/context`,
 *   `view/title`, `commandPalette`.
 * - `command` — the command id to invoke. References a `CommandDecl` (owned) or
 *   `ExternalCommandDecl` (foreign) id.
 * - `when` — optional `WhenAst` (from `./when`) gating visibility. Built via
 *   `When(manifest)`; serialized to a clause string at codegen time.
 * - `group` — optional grouping/ordering hint within the menu location.
 */
const factory = <const Loc extends string, const Cmd extends string>(spec: {
  readonly location: Loc;
  readonly command: Cmd;
  readonly when?: WhenAst;
  readonly group?: string;
}): MenuDecl<Loc, Cmd> => {
  const input = {
    location: spec.location,
    command: spec.command,
    ...(spec.when === undefined ? {} : { when: spec.when }),
    ...(spec.group === undefined ? {} : { group: spec.group }),
  };
  return Object.assign(MenuDeclStruct.make(input), input);
};

export const MenuDecl = Object.assign(factory, {
  Struct: MenuDeclStruct,
  is: Schema.is(MenuDeclStruct),
});
