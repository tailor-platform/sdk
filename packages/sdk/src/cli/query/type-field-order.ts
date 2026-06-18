import { pathToFileURL } from "node:url";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { TailorDBTypeSchema } from "#/parser/service/tailordb/index";
import type { LoadedConfig } from "#/cli/shared/config-loader";

type TypeFieldOrderMap = Map<string, string[]>;

/**
 * Load field definition order for all TailorDB types in a namespace.
 * @param config - Loaded application configuration
 * @param namespace - TailorDB namespace name
 * @returns Map of type name to field names in definition order
 */
export async function loadTypeFieldOrder(
  config: LoadedConfig,
  namespace: string,
): Promise<TypeFieldOrderMap> {
  const fieldOrder: TypeFieldOrderMap = new Map();
  const dbConfig = config.db?.[namespace];

  if (!dbConfig || !("files" in dbConfig) || dbConfig.files.length === 0) {
    return fieldOrder;
  }

  const typeFiles = loadFilesWithIgnores(dbConfig);

  await Promise.all(
    typeFiles.map(async (typeFile) => {
      try {
        const module = await import(pathToFileURL(typeFile).href);

        for (const exportedValue of Object.values(module)) {
          const result = TailorDBTypeSchema.safeParse(exportedValue);
          if (!result.success) {
            continue;
          }

          fieldOrder.set(result.data.name, Object.keys(result.data.fields));
        }
      } catch {
        // Skip files that fail to load
      }
    }),
  );

  return fieldOrder;
}
