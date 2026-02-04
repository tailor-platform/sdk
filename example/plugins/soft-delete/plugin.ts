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
  type PluginGeneratedType,
  type PluginProcessContext,
  type TailorDBTypeForPlugin,
  type TailorAnyDBField,
} from "@tailor-platform/sdk";
import { registerGeneratedType, type GeneratedTypeKind } from "./registry";

/**
 * Configuration options for the soft-delete plugin
 */
interface SoftDeleteConfig {
  /** Whether to include a reason field in the archive type */
  archiveReason?: boolean;
}

/**
 * Helper to attach kind metadata to a generated type.
 * @param type - The TailorDB type to add kind to
 * @param kind - The kind identifier for this generated type
 * @returns The type with kind metadata attached
 */
function withKind<T extends TailorDBTypeForPlugin>(
  type: T,
  kind: GeneratedTypeKind,
): T & PluginGeneratedType {
  return Object.assign(type, { kind });
}

/**
 * Process a type to add soft delete functionality.
 * @param context - Plugin process context
 * @returns Plugin output with extended fields and generated archive type
 */
function processSoftDelete(
  context: PluginProcessContext<SoftDeleteConfig>,
): ReturnType<NonNullable<PluginBase["process"]>> {
  const { type, config } = context;
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

  // Register for getGeneratedType() API
  registerGeneratedType(type, "archive", archiveType);

  // Extend original type with deletedAt field
  const extendFields = {
    deletedAt: db.datetime({ optional: true }).index(),
  };

  return {
    types: [withKind(archiveType, "archive")],
    extends: { fields: extendFields },
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
