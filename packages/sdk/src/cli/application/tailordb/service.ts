import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import { db, type TailorDBType } from "@/configure/services/tailordb/schema";
import {
  parseTypes,
  TailorDBTypeSchema,
  type TypeSourceInfo,
  type TailorDBServiceConfig,
  type TailorDBTypeSchemaOutput,
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
   * Copy metadata from original type to extended type.
   * Preserves files, settings, permissions, indexes, and plugins.
   * @param original - The original TailorDB type with metadata
   * @param extended - The newly created extended type
   * @returns The extended type with copied metadata
   */
  const copyMetadataToExtendedType = (
    original: TailorDBType,
    extended: TailorDBType,
  ): TailorDBType => {
    let result = extended;

    // Copy description
    if (original._description) {
      result = result.description(original._description);
    }

    // Copy files metadata
    const metadata = original.metadata;
    if (metadata.files && Object.keys(metadata.files).length > 0) {
      result = result.files(metadata.files);
    }

    // Copy settings/features (excluding pluralForm which is set during construction)
    if (metadata.settings) {
      const { pluralForm: _pluralForm, ...features } = metadata.settings;
      if (Object.keys(features).length > 0) {
        result = result.features(
          features as typeof features & { aggregation?: true; bulkUpsert?: true },
        );
      }
    }

    // Access private fields for permissions and indexes
    // oxlint-disable-next-line no-explicit-any
    const originalAny = original as any;

    // Copy permissions
    if (originalAny._permissions?.record) {
      result = result.permission(originalAny._permissions.record);
    }
    if (originalAny._permissions?.gql) {
      result = result.gqlPermission(originalAny._permissions.gql);
    }

    // Copy indexes from metadata (indexes are stored in metadata, not as a direct property)
    if (metadata.indexes && Object.keys(metadata.indexes).length > 0) {
      const indexDefs = Object.entries(metadata.indexes).map(([name, def]) => ({
        name,
        // Cast fields array to tuple type (IndexDef expects [T, T, ...T[]])
        fields: def.fields as [string, string, ...string[]],
        unique: def.unique,
      }));
      result = result.indexes(...indexDefs);
    }

    // Copy plugins (but don't re-process them)
    if (originalAny._plugins && originalAny._plugins.length > 0) {
      for (const plugin of originalAny._plugins) {
        result = result.plugin({ [plugin.pluginId]: plugin.config });
      }
    }

    return result;
  };

  /**
   * Extend the fields of a TailorDBType.
   * @param rawType - The original TailorDB type to extend
   * @param extendFields - New fields to add to the type
   * @param sourceFilePath - The file path where the type was loaded from
   * @param pluginId - The ID of the plugin extending the type
   * @returns The extended TailorDBType
   */
  const extendTypeFields = (
    rawType: TailorDBType,
    extendFields: Record<string, unknown>,
    sourceFilePath: string,
    pluginId: string,
  ): TailorDBType => {
    const existingFieldNames = Object.keys(rawType.fields);
    const newFieldNames = Object.keys(extendFields);
    const duplicateFields = newFieldNames.filter((name) => existingFieldNames.includes(name));

    if (duplicateFields.length > 0) {
      throw new Error(
        `Plugin "${pluginId}" attempted to add fields that already exist in type "${rawType.name}": ${duplicateFields.join(", ")}. ` +
          `extendFields cannot overwrite existing fields.`,
      );
    }

    const mergedFields = {
      ...rawType.fields,
      ...extendFields,
    };

    const { id: _id, ...fieldsWithoutId } = mergedFields;
    const extendedType = db.type(rawType.name, fieldsWithoutId);
    const result = copyMetadataToExtendedType(rawType, extendedType);
    rawTypes[sourceFilePath][rawType.name] = result;

    return result;
  };

  /**
   * Process plugins for a type and add generated types to rawTypes
   * @param rawType - The raw TailorDB type being processed
   * @param attachments - Plugin attachments for this type
   * @param sourceFilePath - The file path where the type was loaded from
   */
  const processPluginsForType = async (
    rawType: TailorDBType,
    attachments: PluginAttachment[],
    sourceFilePath: string,
  ): Promise<void> => {
    if (!pluginManager) return;

    let currentType = rawType;

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
        currentType = extendTypeFields(
          currentType,
          extendFields,
          sourceFilePath,
          attachment.pluginId,
        );
        logger.log(
          `  Extended: ${styles.success(currentType.name)} with ${styles.highlight(Object.keys(extendFields).length.toString())} fields by plugin ${styles.info(attachment.pluginId)}`,
        );
      }

      // Add generated types to rawTypes
      for (const [kind, generatedType] of Object.entries(output.types ?? {})) {
        rawTypes[sourceFilePath][generatedType.name] = generatedType as TailorDBType;
        // Plugin-generated types don't have a source file.
        // Generators that need to import these types should generate their own type files.
        typeSourceInfo[generatedType.name] = {
          filePath: "",
          exportName: generatedType.name,
          pluginId: attachment.pluginId,
          pluginImportPath: pluginManager.getPluginImportPath(attachment.pluginId),
          originalFilePath: sourceFilePath,
          originalExportName: rawType.name,
          generatedTypeKind: kind,
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
  };
}
