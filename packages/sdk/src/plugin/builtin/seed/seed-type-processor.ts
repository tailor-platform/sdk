import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBNamespaceData } from "#/plugin/types";
import type { SeedTypeInfo } from "./types";

/**
 * Processes TailorDB types to extract seed type information
 * @param type - Parsed TailorDB type
 * @param namespace - Namespace of the type
 * @returns Seed type information
 */
export function processSeedTypeInfo(type: TailorDBType, namespace: string): SeedTypeInfo {
  // Extract dependencies from relations (including keyOnly which only sets foreignKeyType)
  const dependencies: Set<string> = new Set();
  const selfRefFields: string[] = [];

  for (const [fieldName, field] of Object.entries(type.fields)) {
    const targetType = field.relation?.targetType ?? field.config.foreignKeyType;
    if (!targetType) continue;

    if (targetType === type.name) {
      selfRefFields.push(fieldName);
    } else {
      dependencies.add(targetType);
    }
  }

  return {
    name: type.name,
    namespace,
    dependencies: Array.from(dependencies),
    selfRefFields,
    dataFile: `data/${type.name}.jsonl`,
  };
}

/**
 * Seed ordering information for a TailorDB namespace.
 */
export interface SeedNamespaceConfig {
  /** TailorDB namespace name. */
  namespace: string;
  /** Type names in the namespace, in definition order. */
  types: string[];
  /** Seed dependencies (referenced type names) per type. */
  dependencies: Record<string, string[]>;
  /** Types with self-referencing fields, seeded in two passes. */
  selfRefTypes: string[];
}

/**
 * Build per-namespace seed ordering information from TailorDB namespace data.
 * @param tailordb - TailorDB namespaces with their types
 * @returns Seed namespace configs, in namespace order
 */
export function buildSeedNamespaceConfigs(
  tailordb: TailorDBNamespaceData[],
): SeedNamespaceConfig[] {
  return tailordb.map((ns) => {
    const types: string[] = [];
    const dependencies: Record<string, string[]> = {};
    const selfRefTypes: string[] = [];

    for (const type of Object.values(ns.types)) {
      const typeInfo = processSeedTypeInfo(type, ns.namespace);
      types.push(typeInfo.name);
      dependencies[typeInfo.name] = typeInfo.dependencies;
      if (typeInfo.selfRefFields.length > 0) {
        selfRefTypes.push(typeInfo.name);
      }
    }

    return { namespace: ns.namespace, types, dependencies, selfRefTypes };
  });
}
