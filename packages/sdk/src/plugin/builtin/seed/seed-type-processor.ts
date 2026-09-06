import { assertDefined } from "#/utils/assert";
import { processLinesDb } from "./lines-db-processor";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBNamespaceData } from "#/plugin/types";
import type { SeedTypeInfo } from "./types";

/**
 * Processes TailorDB tables to extract seed table information
 * @param type - Parsed TailorDB table
 * @param namespace - Namespace of the table
 * @returns Seed table information
 */
function processSeedTypeInfo(type: TailorDBType, namespace: string): SeedTypeInfo {
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
  /** Table names in the namespace, in definition order. */
  types: string[];
  /** Seed dependencies (referenced table names) per table. */
  dependencies: Record<string, string[]>;
  /** Tables with self-referencing fields, seeded in two passes. */
  selfRefTypes: string[];
  /** Field names a seed row must supply per table, enforced with `--upsert`. */
  requiredFields: Record<string, string[]>;
  /** Field names the platform assigns rather than the seed row, per table. */
  omitFields?: Record<string, string[]>;
}

/**
 * Build per-namespace seed ordering information from TailorDB namespace data.
 * @param tailordb - TailorDB namespaces with their tables
 * @returns Seed namespace configs, in namespace order
 */
export function buildSeedNamespaceConfigs(
  tailordb: TailorDBNamespaceData[],
): SeedNamespaceConfig[] {
  return tailordb.map((ns) => {
    const types: string[] = [];
    const dependencies: Record<string, string[]> = {};
    const selfRefTypes: string[] = [];
    const requiredFields: Record<string, string[]> = {};
    const omitFields: Record<string, string[]> = {};

    for (const [tableName, type] of Object.entries(ns.tables)) {
      const typeInfo = processSeedTypeInfo(type, ns.namespace);
      types.push(typeInfo.name);
      dependencies[typeInfo.name] = typeInfo.dependencies;
      if (typeInfo.selfRefFields.length > 0) {
        selfRefTypes.push(typeInfo.name);
      }

      const source = assertDefined(
        ns.sourceInfo.get(tableName),
        `source info missing for table: ${tableName}`,
      );
      const linesDb = processLinesDb(type, source);
      omitFields[typeInfo.name] = linesDb.omitFields;
      requiredFields[typeInfo.name] = Object.entries(type.fields)
        .filter(
          ([fieldName, field]) =>
            field.config.required !== false &&
            !linesDb.optionalFields.includes(fieldName) &&
            !linesDb.omitFields.includes(fieldName),
        )
        .map(([fieldName]) => fieldName);
    }

    return {
      namespace: ns.namespace,
      types,
      dependencies,
      selfRefTypes,
      requiredFields,
      omitFields,
    };
  });
}
