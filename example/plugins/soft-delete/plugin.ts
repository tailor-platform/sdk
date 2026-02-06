/**
 * Soft Delete Plugin
 *
 * A type-attached plugin that adds soft delete functionality to TailorDB types.
 *
 * Features:
 * - Adds `deletedAt` field to track when a record was soft-deleted
 * - Generates an Archive type to store deletion metadata (who, when, reason)
 * - Supports global plugin configuration via definePlugins()
 * - Supports per-type configuration via .plugin()
 *
 * Usage:
 * ```typescript
 * import { definePlugins, db } from "@tailor-platform/sdk";
 * import { softDeletePlugin } from "./plugins/soft-delete";
 *
 * // Global plugin configuration (applied to all types using this plugin)
 * export const plugins = definePlugins(
 *   [softDeletePlugin, {
 *     archiveTablePrefix: "Archive_",  // Custom prefix for archive tables
 *     defaultRetentionDays: 90,        // Default retention period
 *   }],
 * );
 *
 * // Per-type configuration
 * export const user = db.type("User", {
 *   name: db.string(),
 *   email: db.string(),
 * }).plugin({
 *   "@example/soft-delete": {
 *     archiveReason: true,   // Include reason field in archive
 *     retentionDays: 365,    // Override retention for this type
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
 * Global plugin configuration (from definePlugins)
 */
export interface SoftDeletePluginConfig {
  /** Prefix for archive table names. Default: "" (uses "{TypeName}Archive") */
  archiveTablePrefix?: string;
  /** Default retention period in days. Archives older than this may be purged. */
  defaultRetentionDays?: number;
}

/**
 * Per-type configuration options (from .plugin())
 */
export interface SoftDeleteConfig {
  /** Whether to include a reason field in the archive type */
  archiveReason?: boolean;
  /** Override retention period for this specific type (in days) */
  retentionDays?: number;
}

// Note: PluginConfigs extension is auto-generated in user-defined.d.ts
// based on the configSchema defined below

/**
 * Generated type kinds for soft-delete plugin.
 */
export type GeneratedTypeKind = "archive";

/**
 * Parameters for generating soft-delete types
 */
interface GenerateTypesParams {
  type: TailorAnyDBType;
  config?: SoftDeleteConfig;
  pluginConfig?: SoftDeletePluginConfig;
}

/**
 * Generate soft-delete types for a source type.
 * @param params - Parameters for type generation
 * @returns Map of kind to generated type
 */
function generateTypes(params: GenerateTypesParams): Record<GeneratedTypeKind, TailorAnyDBType> {
  const { type, config = {}, pluginConfig = {} } = params;

  // Use prefix from pluginConfig if available
  const prefix = pluginConfig.archiveTablePrefix ?? "";
  const archiveName = prefix ? `${prefix}${type.name}` : `${type.name}Archive`;

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
 * Options for getting a generated type
 */
interface GetGeneratedTypeOptions {
  config?: SoftDeleteConfig;
  pluginConfig?: SoftDeletePluginConfig;
}

/**
 * Get a generated type for a source type.
 * @param sourceType - The original type that the plugin is applied to
 * @param kind - The kind of generated type to retrieve
 * @param options - Optional configuration options
 * @returns The generated TailorDB type
 */
export function getGeneratedType(
  sourceType: TailorAnyDBType,
  kind: GeneratedTypeKind,
  options?: GetGeneratedTypeOptions,
): TailorAnyDBType {
  const types = generateTypes({
    type: sourceType,
    config: options?.config,
    pluginConfig: options?.pluginConfig,
  });
  return types[kind];
}

/**
 * Process a type to add soft delete functionality.
 * @param context - Plugin process context
 * @returns Plugin output with extended fields, generated archive type, and executors
 */
function processSoftDelete(
  context: PluginProcessContext<SoftDeleteConfig, SoftDeletePluginConfig>,
): ReturnType<NonNullable<PluginBase["process"]>> {
  const { type, config, pluginConfig, namespace } = context;
  const generatedTypes = generateTypes({ type, config, pluginConfig });

  return {
    types: generatedTypes,
    extends: { fields: generateExtendFields() },
    executors: generateExecutors(type, namespace, generatedTypes),
  };
}

/**
 * Soft delete plugin that adds soft delete functionality to TailorDB types.
 */
export const softDeletePlugin: PluginBase<SoftDeletePluginConfig> = {
  id: "@example/soft-delete",
  description: "Adds soft delete functionality with archive tracking",
  importPath: "./plugins/soft-delete",
  // Schema for per-type config (from .plugin())
  configSchema: t.object({
    archiveReason: t.bool({ optional: true }),
    retentionDays: t.int({ optional: true }),
  }),
  // Schema for global plugin config (from definePlugins())
  pluginConfigSchema: t.object({
    archiveTablePrefix: t.string({ optional: true }),
    defaultRetentionDays: t.int({ optional: true }),
  }),
  process: processSoftDelete,
};
