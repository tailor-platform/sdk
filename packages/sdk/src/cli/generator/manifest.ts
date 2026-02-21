/**
 * Manifest extraction for the TS Language Service Plugin.
 *
 * Produces a JSON manifest describing all namespaces, types, and their
 * source file locations, enabling the plugin to generate `tailor-env.d.ts`
 * without re-running the full generation pipeline.
 */

import * as path from "pathe";
import { type Application } from "@/cli/application";
import { isPluginGeneratedType, type GqlOperations } from "@/parser/service/tailordb/types";

export type ManifestTypeEntry = {
  typeName: string;
  filePath: string;
  exportName: string;
  pluralForm: string;
  gqlOperations?: GqlOperations;
  aggregation?: boolean;
  bulkUpsert?: boolean;
};

export type ManifestNamespace = {
  types: ManifestTypeEntry[];
};

export type Manifest = {
  configDir: string;
  namespaces: Record<string, ManifestNamespace>;
};

/**
 * Extract a manifest from a loaded Application.
 * @param application - The loaded Application instance
 * @param configPath - Absolute path to tailor.config.ts
 * @returns A manifest describing all namespaces and their type sources
 */
export async function extractManifest(
  application: Application,
  configPath: string,
): Promise<Manifest> {
  const configDir = path.dirname(configPath);
  const manifest: Manifest = {
    configDir,
    namespaces: {},
  };

  for (const db of application.tailorDBServices) {
    const namespace = db.namespace;

    await db.loadTypes();

    const types = db.getTypes();
    const sourceInfo = db.getTypeSourceInfo();
    const entries: ManifestTypeEntry[] = [];

    for (const [typeName, parsedType] of Object.entries(types)) {
      const source = sourceInfo[typeName];
      if (!source || isPluginGeneratedType(source)) continue;

      const entry: ManifestTypeEntry = {
        typeName,
        filePath: path.relative(configDir, source.filePath),
        exportName: source.exportName,
        pluralForm: parsedType.pluralForm,
      };
      if (parsedType.settings.gqlOperations) {
        entry.gqlOperations = parsedType.settings.gqlOperations;
      }
      if (parsedType.settings.aggregation) {
        entry.aggregation = parsedType.settings.aggregation;
      }
      if (parsedType.settings.bulkUpsert) {
        entry.bulkUpsert = parsedType.settings.bulkUpsert;
      }
      entries.push(entry);
    }

    manifest.namespaces[namespace] = { types: entries };
  }

  return manifest;
}
