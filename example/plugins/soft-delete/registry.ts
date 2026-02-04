/**
 * Registry for soft-delete plugin generated types.
 *
 * Stores generated types for later retrieval via getGeneratedType().
 */

import type { TailorAnyDBType } from "@tailor-platform/sdk";

/**
 * Generated type kinds for soft-delete plugin.
 */
export type GeneratedTypeKind = "archive";

/**
 * Registry mapping sourceTypeName -> kind -> generatedType
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
 * import { getGeneratedType } from "./plugins/soft-delete";
 * import { user } from "./tailordb/user";
 *
 * // Get the UserArchive type
 * const UserArchive = getGeneratedType(user, "archive");
 * ```
 * @param sourceType - The original type that the plugin was applied to
 * @param kind - The kind of generated type to retrieve
 * @returns The generated TailorDB type
 */
export function getGeneratedType<T extends TailorAnyDBType>(
  sourceType: T,
  kind: GeneratedTypeKind,
): TailorAnyDBType {
  const typeMap = registry.get(sourceType.name);
  if (!typeMap) {
    throw new Error(
      `No generated types found for "${sourceType.name}". ` +
        `Make sure the soft-delete plugin is configured for this type.`,
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
