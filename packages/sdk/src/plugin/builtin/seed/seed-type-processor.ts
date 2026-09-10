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
  const selfRefKeys: Record<string, string> = {};

  for (const [fieldName, field] of Object.entries(type.fields)) {
    const targetType = field.relation?.targetType ?? field.config.foreignKeyType;
    if (!targetType) continue;

    if (targetType === type.name) {
      selfRefFields.push(fieldName);
      // A relation's `toward.key` (or a keyOnly relation's foreignKeyField)
      // can target a non-`id` unique field (e.g. `code`); default to `id`
      // only when the field truly targets the row's id.
      selfRefKeys[fieldName] = field.relation?.key ?? field.config.foreignKeyField ?? "id";
    } else {
      dependencies.add(targetType);
    }
  }

  return {
    name: type.name,
    namespace,
    dependencies: Array.from(dependencies),
    selfRefFields,
    selfRefKeys,
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
  /**
   * Self-referencing field names per table (a subset of the table's own
   * fields, e.g. `parentId`). Lets the seed script order same-table inserts
   * so a row is never inserted before the row it points to.
   */
  selfRefFields?: Record<string, string[]>;
  /**
   * The field each self-referencing field is keyed to, per table (e.g.
   * `{ Category: { parentCode: "code" } }`). A self-reference does not
   * always target the row's `id` — `toward.key` (or a `keyOnly` relation's
   * `foreignKeyField`) can point at another unique field — so the seed
   * script needs this to resolve parent/child edges by the right value
   * instead of assuming `id`.
   */
  selfRefKeys?: Record<string, Record<string, string>>;
}

/**
 * Field names, per target table, that some relation elsewhere is keyed to
 * (`field.relation.key`, or `field.config.foreignKeyField` for a `keyOnly`
 * relation, which never populates `field.relation`) rather than the target's
 * `id`. A `serial` field this set names must survive the dump even though it
 * is otherwise platform-assigned: `apply --truncate` gives the row a fresh
 * serial value, and a relation keyed to the old one would otherwise break
 * silently.
 * @param tailordb - TailorDB namespaces with their tables
 * @returns Relation-targeted field names per target table name
 */
function collectRelationTargetKeys(tailordb: TailorDBNamespaceData[]): Map<string, Set<string>> {
  const targetKeysByType = new Map<string, Set<string>>();
  for (const ns of tailordb) {
    for (const type of Object.values(ns.tables)) {
      for (const field of Object.values(type.fields)) {
        const targetType = field.relation?.targetType ?? field.config.foreignKeyType;
        const key = field.relation?.key ?? field.config.foreignKeyField;
        if (!targetType || !key) continue;
        const keys = targetKeysByType.get(targetType) ?? new Set<string>();
        keys.add(key);
        targetKeysByType.set(targetType, keys);
      }
    }
  }
  return targetKeysByType;
}

/**
 * Build per-namespace seed ordering information from TailorDB namespace data.
 * @param tailordb - TailorDB namespaces with their tables
 * @returns Seed namespace configs, in namespace order
 */
export function buildSeedNamespaceConfigs(
  tailordb: TailorDBNamespaceData[],
): SeedNamespaceConfig[] {
  const relationTargetKeys = collectRelationTargetKeys(tailordb);

  return tailordb.map((ns) => {
    const types: string[] = [];
    const dependencies: Record<string, string[]> = {};
    const selfRefTypes: string[] = [];
    const selfRefFields: Record<string, string[]> = {};
    const selfRefKeys: Record<string, Record<string, string>> = {};
    const requiredFields: Record<string, string[]> = {};
    const omitFields: Record<string, string[]> = {};

    for (const [tableName, type] of Object.entries(ns.tables)) {
      const typeInfo = processSeedTypeInfo(type, ns.namespace);
      types.push(typeInfo.name);
      dependencies[typeInfo.name] = typeInfo.dependencies;
      selfRefFields[typeInfo.name] = typeInfo.selfRefFields;
      selfRefKeys[typeInfo.name] = typeInfo.selfRefKeys;
      if (typeInfo.selfRefFields.length > 0) {
        selfRefTypes.push(typeInfo.name);
      }

      const source = assertDefined(
        ns.sourceInfo.get(tableName),
        `source info missing for table: ${tableName}`,
      );
      const linesDb = processLinesDb(type, source);
      const keptRelationKeys = relationTargetKeys.get(typeInfo.name);
      omitFields[typeInfo.name] = keptRelationKeys
        ? linesDb.omitFields.filter((fieldName) => !keptRelationKeys.has(fieldName))
        : linesDb.omitFields;
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
      selfRefFields,
      selfRefKeys,
      requiredFields,
      omitFields,
    };
  });
}
