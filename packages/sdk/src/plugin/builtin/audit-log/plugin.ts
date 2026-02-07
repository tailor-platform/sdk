/**
 * Audit Log Plugin
 *
 * A standalone plugin that generates audit log types without requiring
 * attachment to a specific TailorDB type.
 *
 * This plugin demonstrates the processStandalone method which generates
 * types independently via definePlugins().
 */

import { db, t } from "@/configure";
import type { TailorAnyDBType } from "@/configure/services/tailordb/schema";
import type { PluginBase, StandalonePluginProcessContext } from "@/parser/plugin-config/types";

/**
 * Generated type kinds for audit-log plugin.
 */
export type GeneratedTypeKind = "audit-log";

/**
 * Generate audit-log types.
 * @returns Map of kind to generated type
 */
function generateTypes(): Record<GeneratedTypeKind, TailorAnyDBType> {
  const auditLogType = db
    .type("AuditLog", {
      // Reference to the type that was modified
      targetType: db.string().index(),
      // Reference to the record that was modified
      targetId: db.uuid().index(),
      // The action that was performed
      action: db.enum(["CREATE", "UPDATE", "DELETE"]).index(),
      // The user who performed the action
      performedBy: db.uuid().index(),
      // When the action was performed
      performedAt: db.datetime().index(),
      // JSON representation of the changes
      changes: db.string({ optional: true }),
      // Previous values (for UPDATE/DELETE)
      previousValues: db.string({ optional: true }),
      // New values (for CREATE/UPDATE)
      newValues: db.string({ optional: true }),
      // Additional metadata
      metadata: db.string({ optional: true }),
      ...db.fields.timestamps(),
    })
    .description("Audit log for tracking changes across the application")
    .indexes({
      name: "idx_audit_target",
      fields: ["targetType", "targetId"],
    });

  return {
    "audit-log": auditLogType,
  };
}

/**
 * Get a generated type from the audit-log plugin.
 * For standalone plugins, pass `null` as the first argument.
 * @param _sourceType - Always null for standalone plugins
 * @param kind - The kind of generated type to retrieve
 * @returns The generated TailorDB type
 */
export function getGeneratedType(_sourceType: null, kind: GeneratedTypeKind): TailorAnyDBType {
  const types = generateTypes();
  return types[kind];
}

/**
 * Audit log plugin that generates an AuditLog type for tracking
 * changes across the application.
 */
export const auditLogPlugin: PluginBase = {
  id: "@tailor-platform/audit-log",
  description: "Generates audit log types for tracking changes",
  importPath: "@tailor-platform/sdk/audit-log-plugin",
  configSchema: t.bool(),

  /**
   * Process standalone - generates audit log types without a source type.
   * @param _context - The standalone plugin context (unused in this plugin)
   * @returns Plugin output with generated types
   */
  processStandalone(
    _context: StandalonePluginProcessContext,
  ): ReturnType<NonNullable<PluginBase["processStandalone"]>> {
    return {
      types: generateTypes(),
    };
  },
};
