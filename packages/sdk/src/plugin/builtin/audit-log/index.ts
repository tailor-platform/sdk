/**
 * Audit Log Plugin Module
 *
 * Exports the audit log plugin for standalone type generation.
 * @example
 * ```typescript
 * import { getGeneratedType } from "@tailor-platform/sdk/audit-log-plugin";
 *
 * // Get the AuditLog type
 * const AuditLog = getGeneratedType(null, "audit-log");
 *
 * // Use the type
 * const schema = AuditLog.pickFields(["id", "action"], { optional: true });
 * ```
 */

export { auditLogPlugin, getGeneratedType } from "./plugin";
export type { GeneratedTypeKind } from "./plugin";
