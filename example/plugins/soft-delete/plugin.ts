/**
 * Soft Delete Plugin
 *
 * A type-attached plugin that adds soft delete functionality to TailorDB types.
 *
 * Features:
 * - Adds `deletedAt` field to track when a record was soft-deleted
 * - Generates an Archive type to store deletion metadata (who, when, reason)
 *
 * Usage:
 * ```typescript
 * import { db } from "@tailor-platform/sdk";
 *
 * export const user = db.type("User", {
 *   name: db.string(),
 *   email: db.string(),
 * }).plugin({
 *   "@example/soft-delete": {
 *     archiveReason: true, // Include reason field in archive
 *   },
 * });
 * ```
 */

import {
  db,
  t,
  type PluginBase,
  type PluginGeneratedExecutorWithFile,
  type PluginProcessContext,
  type TailorAnyDBType,
  type TailorAnyDBField,
} from "@tailor-platform/sdk";
import type { SoftDeleteContext } from "./types";

/**
 * Configuration options for the soft-delete plugin
 */
export interface SoftDeleteConfig {
  /** Whether to include a reason field in the archive type */
  archiveReason?: boolean;
}

// Note: PluginConfigs extension is auto-generated in user-defined.d.ts
// based on the configSchema defined below

/**
 * Generated type kinds for soft-delete plugin.
 */
export type GeneratedTypeKind = "archive";

/**
 * Generate soft-delete types for a source type.
 * @param type - The source TailorDB type
 * @param config - Plugin configuration
 * @returns Map of kind to generated type
 */
function generateTypes(
  type: TailorAnyDBType,
  config: SoftDeleteConfig = {},
): Record<GeneratedTypeKind, TailorAnyDBType> {
  const archiveName = `${type.name}Archive`;

  // Build archive type fields
  const archiveFields: Record<string, TailorAnyDBField> = {
    // Reference to the original record (before deletion)
    originalId: db.uuid().index(),
    // Copy of the original data as JSON
    originalData: db.string(),
    // When it was deleted
    deletedAt: db.datetime().index(),
    // Who deleted it
    deletedBy: db.uuid().index(),
    ...db.fields.timestamps(),
  };

  // Add optional reason field if configured
  if (config.archiveReason) {
    archiveFields.reason = db.string({ optional: true });
  }

  // Create archive type
  const archiveType = db
    .type(archiveName, archiveFields)
    .description(`Archive of soft-deleted ${type.name} records`)
    .indexes({
      name: `${archiveName.toLowerCase()}_deleted_at_idx`,
      fields: ["deletedAt", "originalId"],
    });

  return { archive: archiveType };
}

/**
 * Generate extend fields for the source type.
 * @returns Fields to add to the source type
 */
function generateExtendFields() {
  return {
    deletedAt: db.datetime({ optional: true }).index(),
  };
}

/**
 * Generate executors for soft-delete plugin.
 * @param sourceType - The source TailorDB type
 * @param namespace - The TailorDB namespace
 * @param generatedTypes - Generated types from generateTypes
 * @returns Array of executor definitions
 */
function generateExecutors(
  sourceType: TailorAnyDBType,
  namespace: string,
  generatedTypes: Record<GeneratedTypeKind, TailorAnyDBType>,
): PluginGeneratedExecutorWithFile<SoftDeleteContext>[] {
  const ctx: SoftDeleteContext = {
    sourceType,
    archiveType: generatedTypes.archive,
    namespace,
  };

  return [
    {
      name: `${sourceType.name.toLowerCase()}-archive-on-delete`,
      executorExport: "onDelete",
      context: ctx,
    },
  ];
}

/**
 * Get a generated type for a source type.
 * @param sourceType - The original type that the plugin is applied to
 * @param kind - The kind of generated type to retrieve
 * @param config - Optional plugin configuration
 * @returns The generated TailorDB type
 */
export function getGeneratedType(
  sourceType: TailorAnyDBType,
  kind: GeneratedTypeKind,
  config?: SoftDeleteConfig,
): TailorAnyDBType {
  const types = generateTypes(sourceType, config);
  return types[kind];
}

/**
 * Process a type to add soft delete functionality.
 * @param context - Plugin process context
 * @returns Plugin output with extended fields, generated archive type, and executors
 */
function processSoftDelete(
  context: PluginProcessContext<SoftDeleteConfig>,
): ReturnType<NonNullable<PluginBase["process"]>> {
  const { type, config, namespace } = context;
  const generatedTypes = generateTypes(type, config);

  return {
    types: generatedTypes,
    extends: { fields: generateExtendFields() },
    executors: generateExecutors(type, namespace, generatedTypes),
  };
}

/**
 * Soft delete plugin that adds soft delete functionality to TailorDB types.
 */
export const softDeletePlugin: PluginBase = {
  id: "@example/soft-delete",
  description: "Adds soft delete functionality with archive tracking",
  importPath: "./plugins/soft-delete",
  configSchema: t.object({
    archiveReason: t.bool({ optional: true }),
  }),
  process: processSoftDelete,
};
