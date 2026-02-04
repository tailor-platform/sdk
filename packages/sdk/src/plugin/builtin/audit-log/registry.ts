/**
 * Registry for audit-log plugin generated types.
 *
 * Stores generated types for later retrieval via getGeneratedType().
 */

import type { TailorAnyDBType } from "@/configure/services/tailordb/schema";

/**
 * Generated type kinds for audit-log plugin.
 */
export type GeneratedTypeKind = "audit-log";

/**
 * Registry mapping kind → generatedType
 */
const registry = new Map<GeneratedTypeKind, TailorAnyDBType>();

/**
 * Register a generated type in the registry.
 * @param kind - The kind identifier for this generated type
 * @param generatedType - The generated TailorDB type
 */
export function registerGeneratedType(
  kind: GeneratedTypeKind,
  generatedType: TailorAnyDBType,
): void {
  registry.set(kind, generatedType);
}

/**
 * Get a generated type from the registry by kind.
 * @example
 * ```typescript
 * import { getGeneratedType } from "@tailor-platform/sdk/audit-log-plugin";
 *
 * // Get the AuditLog type
 * const AuditLog = getGeneratedType("audit-log");
 * ```
 * @param kind - The kind of the generated type to retrieve
 * @returns The generated TailorDB type
 * @throws Error if the type is not found in the registry
 */
export function getGeneratedType(kind: GeneratedTypeKind): TailorAnyDBType {
  const generatedType = registry.get(kind);
  if (!generatedType) {
    throw new Error(
      `Generated type "${kind}" not found. ` + `Make sure the audit-log plugin is configured.`,
    );
  }
  return generatedType;
}

/**
 * Get the AuditLog type directly.
 * @example
 * ```typescript
 * import { AuditLog } from "@tailor-platform/sdk/audit-log-plugin";
 *
 * // Use AuditLog type directly
 * const schema = AuditLog.pickFields(["id", "action"], { optional: true });
 * ```
 * @returns The AuditLog TailorDB type
 * @throws Error if the AuditLog type is not found in the registry
 */
export function getAuditLogType(): TailorAnyDBType {
  return getGeneratedType("audit-log");
}
