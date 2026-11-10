import type { NamespacePluginOutput, Plugin, PluginNamespaceProcessContext } from "@tailor-platform/sdk";
import { db } from "@tailor-platform/sdk";

export function auditLogPlugin(): Plugin {
  return {
    id: "@example/audit-log",
    description: "Adds an audit log table",
    importPath: "@example/audit-log",
    onNamespaceLoaded(context: PluginNamespaceProcessContext): NamespacePluginOutput {
      return { tables: { auditLog: db.table(`AuditLog_${context.namespace}`, {}) } };
    },
  };
}
