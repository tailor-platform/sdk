import type { TailorDBType } from "#/parser/service/tailordb/types";
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
