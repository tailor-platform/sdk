import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import { type TailorDBType } from "@/configure/services/tailordb/schema";
import {
  parseTypes,
  type ParsedTailorDBType,
  type TypeSourceInfo,
} from "@/parser/service/tailordb";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";

export type TailorDBService = {
  readonly namespace: string;
  readonly config: TailorDBServiceConfig;
  getTypes(): Readonly<Record<string, ParsedTailorDBType>>;
  getTypeSourceInfo(): Readonly<TypeSourceInfo>;
  loadTypes(): Promise<Record<string, ParsedTailorDBType> | undefined>;
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
  const rawTypes: Record<string, Record<string, TailorDBType>> = {};
  let types: Record<string, ParsedTailorDBType> = {};
  const typeSourceInfo: TypeSourceInfo = {};

  const doParseTypes = (): void => {
    const allTypes: Record<string, TailorDBType> = {};
    for (const fileTypes of Object.values(rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        allTypes[typeName] = type;
      }
    }

    types = parseTypes(allTypes, namespace, typeSourceInfo);
  };

  const loadTypeFile = async (typeFile: string): Promise<Record<string, TailorDBType>> => {
    rawTypes[typeFile] = {};
    const loadedTypes: Record<string, TailorDBType> = {};
    try {
      const module = await import(pathToFileURL(typeFile).href);

      for (const exportName of Object.keys(module)) {
        const exportedValue = module[exportName];

        const isDBTypeLike =
          exportedValue &&
          typeof exportedValue === "object" &&
          exportedValue.constructor?.name === "TailorDBType" &&
          typeof exportedValue.name === "string" &&
          typeof exportedValue.fields === "object" &&
          exportedValue.metadata &&
          typeof exportedValue.metadata === "object";

        if (isDBTypeLike) {
          const relativePath = path.relative(process.cwd(), typeFile);
          logger.log(
            `Type: ${styles.successBright(`"${exportName}"`)} loaded from ${styles.path(relativePath)}`,
          );
          rawTypes[typeFile][exportedValue.name] = exportedValue;
          loadedTypes[exportedValue.name] = exportedValue;
          // Store source info mapping
          typeSourceInfo[exportedValue.name] = {
            filePath: typeFile,
            exportName,
          };
        }
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
