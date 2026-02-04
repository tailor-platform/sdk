/**
 * Registry for audit-log plugin generated types.
 *
 * Stores generated types for later retrieval via getGeneratedType().
 */

import type { TailorAnyDBType } from "@/configure/services/tailordb/schema";

/**
 * Registry mapping typeName → generatedType
 */
const registry = new Map<string, TailorAnyDBType>();

/**
 * Register a generated type in the registry.
 * @param generatedType - The generated TailorDB type
 */
export function registerGeneratedType(generatedType: TailorAnyDBType): void {
  registry.set(generatedType.name, generatedType);
}

/**
 * Get a generated type from the registry by name.
 * @example
 * ```typescript
 * import { getGeneratedType } from "@tailor-platform/sdk/audit-log-plugin";
 *
 * // Get the AuditLog type
 * const AuditLog = getGeneratedType("AuditLog");
 * ```
 * @param typeName - The name of the generated type to retrieve
 * @returns The generated TailorDB type
 * @throws Error if the type is not found in the registry
 */
export function getGeneratedType(typeName: string): TailorAnyDBType {
  const generatedType = registry.get(typeName);
  if (!generatedType) {
    throw new Error(
      `Generated type "${typeName}" not found. ` + `Make sure the audit-log plugin is configured.`,
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
  return getGeneratedType("AuditLog");
}
