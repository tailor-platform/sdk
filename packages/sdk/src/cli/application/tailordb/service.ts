import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import {
  parseTypes,
  TailorDBTypeSchema,
  type NormalizedTailorDBType,
  type TypeSourceInfo,
  type TailorDBServiceConfig,
  type TailorDBTypeInput,
} from "@/parser/service/tailordb";

export type TailorDBService = {
  readonly namespace: string;
  readonly config: TailorDBServiceConfig;
  getTypes: () => Readonly<Record<string, NormalizedTailorDBType>>;
  getTypeSourceInfo: () => Readonly<TypeSourceInfo>;
  loadTypes: () => Promise<Record<string, NormalizedTailorDBType> | undefined>;
};

/**
 * Creates a new TailorDBService instance.
 * @param namespace - The namespace for this TailorDB service
 * @param config - The TailorDB service configuration
 * @returns A new TailorDBService instance
 */
export function createTailorDBService(
  namespace: string,
  config: TailorDBServiceConfig,
): TailorDBService {
  type ParsedInputTypes = Record<string, TailorDBTypeInput>;
  const rawTypes: Record<string, ParsedInputTypes> = {};
  let types: Record<string, NormalizedTailorDBType> = {};
  const typeSourceInfo: TypeSourceInfo = {};

  const doParseTypes = (): void => {
    const allTypes: ParsedInputTypes = {};
    for (const fileTypes of Object.values(rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        allTypes[typeName] = type;
      }
    }

    types = parseTypes(allTypes, namespace, typeSourceInfo);
  };

  const loadTypeFile = async (typeFile: string): Promise<ParsedInputTypes> => {
    rawTypes[typeFile] = {};
    const loadedTypes: ParsedInputTypes = {};
    try {
      const module = await import(pathToFileURL(typeFile).href);

      for (const exportName of Object.keys(module)) {
        const exportedValue = module[exportName];

        const result = TailorDBTypeSchema.safeParse(exportedValue);
        if (!result.success) {
          continue;
        }

        const relativePath = path.relative(process.cwd(), typeFile);
        logger.log(
          `Type: ${styles.successBright(`"${result.data.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        rawTypes[typeFile][result.data.name] = exportedValue;
        loadedTypes[result.data.name] = exportedValue;
        // Store source info mapping
        typeSourceInfo[result.data.name] = {
          filePath: typeFile,
          exportName,
        };
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), typeFile);
      logger.error(`Failed to load type from ${styles.bold(relativePath)}`);
      logger.error(String(error));
      throw error;
    }
    return loadedTypes;
  };

  return {
    namespace,
    config,
    getTypes: () => types,
    getTypeSourceInfo: () => typeSourceInfo,
    loadTypes: async () => {
      if (Object.keys(rawTypes).length > 0) {
        return types;
      }

      if (!config.files || config.files.length === 0) {
        return;
      }

      const typeFiles = loadFilesWithIgnores(config);

      logger.newline();
      logger.log(
        `Found ${styles.highlight(typeFiles.length.toString())} type files for TailorDB service ${styles.highlight(`"${namespace}"`)}`,
      );

      await Promise.all(typeFiles.map((typeFile) => loadTypeFile(typeFile)));
      doParseTypes();
      return types;
    },
  };
}
