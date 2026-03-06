import type { SeedTypeInfo } from "./types";
import type { TailorDBType } from "@/types/tailordb";

/**
 * Processes TailorDB types to extract seed type information
 * @param type - Parsed TailorDB type
 * @param namespace - Namespace of the type
 * @returns Seed type information
 */
export function processSeedTypeInfo(type: TailorDBType, namespace: string): SeedTypeInfo {
  // Extract dependencies from relations (including keyOnly which only sets foreignKeyType)
  const dependencies = Array.from(
    Object.values(type.fields).reduce<Set<string>>((set, field) => {
      const targetType = field.relation?.targetType ?? field.config.foreignKeyType;
      if (targetType && targetType !== type.name) {
        set.add(targetType);
      }
      return set;
    }, new Set<string>()),
  );

  return {
    name: type.name,
    namespace,
    dependencies,
    dataFile: `data/${type.name}.jsonl`,
  };
}
