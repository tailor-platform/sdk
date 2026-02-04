/**
 * Registry for changeset plugin generated types.
 *
 * Stores generated types for later retrieval via getGeneratedType().
 */

import type { TailorAnyDBType } from "@/configure/services/tailordb/schema";

/**
 * Generated type kinds for changeset plugin.
 */
export type GeneratedTypeKind = "request" | "step" | "approval" | "rework";

/**
 * Registry mapping sourceTypeName → kind → generatedType
 */
const registry = new Map<string, Map<GeneratedTypeKind, TailorAnyDBType>>();

/**
 * Register a generated type in the registry.
 * @param sourceType - The original type that the plugin was applied to
 * @param kind - The kind of generated type
 * @param generatedType - The generated TailorDB type
 */
export function registerGeneratedType(
  sourceType: TailorAnyDBType,
  kind: GeneratedTypeKind,
  generatedType: TailorAnyDBType,
): void {
  if (!registry.has(sourceType.name)) {
    registry.set(sourceType.name, new Map());
  }
  registry.get(sourceType.name)!.set(kind, generatedType);
}

/**
 * Get a generated type from the registry.
 * @example
 * ```typescript
 * import { getGeneratedType } from "@tailor-platform/sdk/changeset-plugin";
 * import { user } from "./tailordb/user";
 *
 * // Get the UserChangeRequest type
 * const UserChangeRequest = getGeneratedType(user, "request");
 *
 * // Get other generated types
 * const UserChangeStep = getGeneratedType(user, "step");
 * const UserChangeApproval = getGeneratedType(user, "approval");
 * const UserChangeReworkEvent = getGeneratedType(user, "rework");
 * ```
 * @param sourceType - The original type that the plugin was applied to
 * @param kind - The kind of generated type to retrieve
 * @returns The generated TailorDB type
 * @throws Error if the type or kind is not found in the registry
 */
export function getGeneratedType<T extends TailorAnyDBType>(
  sourceType: T,
  kind: GeneratedTypeKind,
): TailorAnyDBType {
  const typeMap = registry.get(sourceType.name);
  if (!typeMap) {
    throw new Error(
      `No generated types found for "${sourceType.name}". ` +
        `Make sure the changeset plugin is configured for this type.`,
    );
  }
  const generatedType = typeMap.get(kind);
  if (!generatedType) {
    throw new Error(
      `Generated type "${kind}" not found for "${sourceType.name}". ` +
        `Available kinds: ${Array.from(typeMap.keys()).join(", ")}`,
    );
  }
  return generatedType;
}
