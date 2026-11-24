import {
  Array,
  Effect,
  FileSystem,
  JsonSchema,
  Predicate,
  Record,
  Schema,
} from 'effect';
import type { Manifest } from '#lib/manifest/schema';
import { WhenClause } from '#lib/when/when';

export type JsonObject = Record<string, unknown>;

export const asJsonObject = (value: unknown) =>
  Predicate.isObject(value) ? value : undefined;

const PackageJson = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown),
  {
    space: 2,
  },
);

export class ConfigurationSchemaError extends Schema.TaggedError<
  ConfigurationSchemaError,
  {}
>()('ConfigurationSchemaError', {
  key: Schema.String,
  cause: Schema.Defect(),
}) {}

export const mergeManifestIntoPackageJson = Effect.fnUntraced(function* (
  manifest: Manifest,
  existingPackageJson: JsonObject,
) {
  const result: JsonObject = { ...existingPackageJson };

  result['name'] = manifest.name;
  result['publisher'] = manifest.publisher;
  if (manifest.displayName !== undefined)
    result['displayName'] = manifest.displayName;
  if (manifest.description !== undefined)
    result['description'] = manifest.description;
  if (manifest.version !== undefined) result['version'] = manifest.version;

  if (manifest.engineVscode !== undefined) {
    const engines: JsonObject = {
      ...asJsonObject(existingPackageJson['engines']),
    };
    engines['vscode'] = manifest.engineVscode;
    result['engines'] = engines;
  }

  if (manifest.activationEvents !== undefined) {
    result['activationEvents'] = [...manifest.activationEvents];
  }

  if (manifest.extensionDependencies !== undefined) {
    result['extensionDependencies'] = [...manifest.extensionDependencies];
  }

  const contributes: JsonObject = {
    ...asJsonObject(existingPackageJson['contributes']),
  };

  if (manifest.commands !== undefined) {
    contributes['commands'] = Array.map(manifest.commands, (c) => {
      const entry: JsonObject = { command: c.id };
      if (c.title !== undefined) entry['title'] = c.title;
      if (c.category !== undefined) entry['category'] = c.category;
      return entry;
    });
  }

  if (manifest.config !== undefined && manifest.config.length > 0) {
    const properties: JsonObject = {};
    for (const c of manifest.config) {
      const { schema, definitions } = yield* Effect.try({
        try: () =>
          JsonSchema.toDocumentDraft07(
            Schema.toJsonSchemaDocument(c.valueSchema),
          ),
        catch: (cause) => ConfigurationSchemaError.make({ key: c.key, cause }),
      });
      const entry: JsonObject = {
        ...schema,
        ...(Record.isEmptyRecord(definitions) ? {} : { definitions }),
      };
      if (c.description !== undefined) {
        entry['description'] = c.description;
      }
      properties[c.key] = entry;
    }
    contributes['configuration'] = { type: 'object', properties };
  }

  if (manifest.menus !== undefined && manifest.menus.length > 0) {
    // `contributes.menus` is keyed by menu location (`explorer/context`,
    // `commandPalette`, …); each value is the array of entries for that
    // location, in declared order. The flat `MenuDecl[]` is grouped here.
    const menus: { [location: string]: Array<JsonObject> } = {};
    for (const m of manifest.menus) {
      const entry: JsonObject = { command: m.command };
      if (m.when !== undefined) {
        // Serialize the `WhenAst` to VS Code's canonical clause string. This
        // is the first codegen consumer of the when builder's codec.
        entry['when'] = yield* Schema.encodeEffect(WhenClause)(m.when);
      }
      if (m.group !== undefined) entry['group'] = m.group;
      (menus[m.location] ??= []).push(entry);
    }
    contributes['menus'] = menus;
  }

  if (!Record.isEmptyRecord(contributes)) {
    result['contributes'] = contributes;
  }

  return result;
});

export const writePackageJson = Effect.fnUntraced(function* (
  path: string,
  data: JsonObject,
) {
  const fs = yield* FileSystem.FileSystem;
  const serialized = yield* Schema.encodeEffect(PackageJson)(data);
  yield* fs.writeFileString(path, `${serialized}\n`);
});

export const readPackageJson = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(path);
  return yield* Schema.decodeEffect(PackageJson)(raw);
});
