import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import {
  parseTypes,
  TailorDBTypeSchema,
  type TypeSourceInfo,
  type TailorDBServiceConfig,
  type TailorDBTypeSchemaOutput,
  type TailorDBType,
  type TailorAnyDBType,
} from "@/parser/service/tailordb";
import type { PluginAttachment } from "@/parser/plugin-config/types";
import type { PluginManager } from "@/plugin/manager";

export type TailorDBService = {
  readonly namespace: string;
  readonly config: TailorDBServiceConfig;
  getTypes: () => Readonly<Record<string, TailorDBType>>;
  getTypeSourceInfo: () => Readonly<TypeSourceInfo>;
  getPluginAttachments: () => ReadonlyMap<string, readonly PluginAttachment[]>;
  setPluginManager: (manager: PluginManager) => void;
  loadTypes: () => Promise<Record<string, TailorDBType> | undefined>;
  processStandalonePlugins: () => Promise<void>;
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
  type TailorDBTypesByName = Record<string, TailorDBTypeSchemaOutput>;
  const rawTypes: Record<string, TailorDBTypesByName> = {};
  let types: Record<string, TailorDBType> = {};
  const typeSourceInfo: TypeSourceInfo = {};
  const pluginAttachments: Map<string, PluginAttachment[]> = new Map();
  let pluginManager: PluginManager | undefined;

  const doParseTypes = (): void => {
    const allTypes: TailorDBTypesByName = {};
    for (const fileTypes of Object.values(rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        allTypes[typeName] = type;
      }
    }

    types = parseTypes(allTypes, namespace, typeSourceInfo);
  };

  /**
   * Process plugins for a type and add generated types to rawTypes
   * @param rawType - The raw TailorDB type being processed
   * @param attachments - Plugin attachments for this type
   * @param sourceFilePath - The file path where the type was loaded from
   */
  const processPluginsForType = async (
    rawType: TailorAnyDBType,
    attachments: PluginAttachment[],
    sourceFilePath: string,
  ): Promise<void> => {
    if (!pluginManager) return;

    let currentType: TailorAnyDBType = rawType;

    for (const attachment of attachments) {
      const result = await pluginManager.processAttachment({
        type: currentType,
        config: attachment.config,
        namespace,
        pluginId: attachment.pluginId,
      });

      if (!result.success) {
        logger.error(result.error);
        throw new Error(result.error);
      }

      const output = result.output;

      // Extend the original type with new fields (if any)
      const extendFields = output.extends?.fields;
      if (extendFields && Object.keys(extendFields).length > 0) {
        const extendedType = pluginManager.extendType({
          originalType: currentType,
          extendFields,
          pluginId: attachment.pluginId,
        });
        rawTypes[sourceFilePath][currentType.name] = extendedType as TailorDBTypeSchemaOutput;
        currentType = extendedType;
        logger.log(
          `  Extended: ${styles.success(currentType.name)} with ${styles.highlight(Object.keys(extendFields).length.toString())} fields by plugin ${styles.info(attachment.pluginId)}`,
        );
      }

      // Add generated types to rawTypes
      for (const [kind, generatedType] of Object.entries(output.types ?? {})) {
        rawTypes[sourceFilePath][generatedType.name] = generatedType as TailorDBTypeSchemaOutput;
        // Plugin-generated types don't have a source file.
        // Generators that need to import these types should generate their own type files.
        typeSourceInfo[generatedType.name] = {
          filePath: "",
          exportName: generatedType.name,
          pluginId: attachment.pluginId,
          pluginImportPath: pluginManager.getPluginImportPath(attachment.pluginId),
          originalFilePath: sourceFilePath,
          originalExportName: typeSourceInfo[rawType.name]?.exportName || rawType.name,
          generatedTypeKind: kind,
          pluginConfig: attachment.config,
        };

        logger.log(
          `  Generated: ${styles.success(generatedType.name)} by plugin ${styles.info(attachment.pluginId)}`,
        );
      }
    }
  };

  const loadTypeFile = async (typeFile: string): Promise<TailorDBTypesByName> => {
    rawTypes[typeFile] = {};
    const loadedTypes: TailorDBTypesByName = {};
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
        rawTypes[typeFile][result.data.name] = result.data;
        loadedTypes[result.data.name] = result.data;
        // Store source info mapping
        typeSourceInfo[result.data.name] = {
          filePath: typeFile,
          exportName,
        };

        // Process plugins if any
        if (
          exportedValue.plugins &&
          Array.isArray(exportedValue.plugins) &&
          exportedValue.plugins.length > 0
        ) {
          pluginAttachments.set(exportedValue.name, [...exportedValue.plugins]);
          logger.log(
            `  Plugin attachments: ${styles.info(exportedValue.plugins.map((p: PluginAttachment) => p.pluginId).join(", "))}`,
          );

          await processPluginsForType(exportedValue, exportedValue.plugins, typeFile);
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
    getPluginAttachments: () => pluginAttachments,
    setPluginManager: (manager: PluginManager) => {
      pluginManager = manager;
    },
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
    processStandalonePlugins: async () => {
      if (!pluginManager) return;

      const results = await pluginManager.processStandalonePlugins(namespace);
      const standaloneKey = "__standalone__";

      if (!rawTypes[standaloneKey]) {
        rawTypes[standaloneKey] = {};
      }

      for (const { pluginId, config, result } of results) {
        if (!result.success) {
          logger.error(result.error);
          throw new Error(result.error);
        }

        const output = result.output;

        // Add generated types to rawTypes
        for (const [kind, generatedType] of Object.entries(output.types ?? {})) {
          rawTypes[standaloneKey][generatedType.name] = generatedType as TailorDBTypeSchemaOutput;
          typeSourceInfo[generatedType.name] = {
            filePath: "",
            exportName: generatedType.name,
            pluginId,
            pluginImportPath: pluginManager.getPluginImportPath(pluginId),
            generatedTypeKind: kind,
            pluginConfig: config,
          };

          logger.log(
            `  Generated: ${styles.success(generatedType.name)} by standalone plugin ${styles.info(pluginId)}`,
          );
        }
      }

      // Re-parse types to include standalone plugin types
      if (results.length > 0) {
        doParseTypes();
      }
    },
  };
}
