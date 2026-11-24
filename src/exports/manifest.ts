export {
  CommandDecl,
  ConfigDecl,
  ContextKeyDecl,
  ExternalCommandDecl,
  ExternalContextKeyDecl,
  ForeignConfigDecl,
  Manifest,
  MenuDecl,
  StateDecl,
} from '#lib/manifest/schema';
export { type MenuDecl as MenuDeclType } from '#lib/manifest/decls/menu';
export {
  defineManifest,
  type ManifestSpec,
  type TypedManifest,
} from '#lib/manifest/define';
export {
  type CommandId,
  Menu,
  type MenuBuilder,
} from '#lib/manifest/menu-builder';
