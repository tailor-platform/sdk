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
import { registerGeneratedType } from "./registry";
import type { PluginBase, StandalonePluginProcessContext } from "@/parser/plugin-config/types";

/**
 * Audit log plugin that generates an AuditLog type for tracking
 * changes across the application.
 */
export const auditLogPlugin: PluginBase = {
  id: "@tailor-platform/audit-log",
  description: "Generates audit log types for tracking changes",
  configSchema: t.bool(),

  /**
   * Process standalone - generates audit log types without a source type.
   * @param _context - The standalone plugin context (unused in this plugin)
   * @returns Plugin output with generated types
   */
  processStandalone(
    _context: StandalonePluginProcessContext,
  ): ReturnType<NonNullable<PluginBase["processStandalone"]>> {
    // Generate AuditLog type
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

    // Register generated type in the registry for later retrieval
    registerGeneratedType(auditLogType);

    return {
      types: [auditLogType],
    };
  },
};
