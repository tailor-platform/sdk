import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import { db, type TailorDBType } from "@/configure/services/tailordb/schema";
import {
  parseTypes,
  type ParsedTailorDBType,
  type TypeSourceInfo,
} from "@/parser/service/tailordb";
import type { PluginManager } from "@/cli/plugin/manager";
import type { TailorDBServiceConfig } from "@/configure/services/tailordb/types";
import type { PluginAttachment } from "@/parser/plugin-config/types";

export class TailorDBService {
  private rawTypes: Record<string, Record<string, TailorDBType>> = {};
  private types: Record<string, ParsedTailorDBType> = {};
  private typeSourceInfo: TypeSourceInfo = {};
  private pluginAttachments: Map<string, PluginAttachment[]> = new Map();
  private pluginManager?: PluginManager;

  constructor(
    public readonly namespace: string,
    public readonly config: TailorDBServiceConfig,
    pluginManager?: PluginManager,
  ) {
    this.pluginManager = pluginManager;
  }

  getTypes() {
    return this.types as Readonly<typeof this.types>;
  }

  getTypeSourceInfo() {
    return this.typeSourceInfo as Readonly<typeof this.typeSourceInfo>;
  }

  /**
   * Set the plugin manager for processing plugin attachments.
   * This should be called before loadTypes() if plugins are enabled.
   * @param manager - The PluginManager instance
   */
  setPluginManager(manager: PluginManager): void {
    this.pluginManager = manager;
  }

  /**
   * Get plugin attachments for all types in this service
   * @returns Map of type name to plugin attachments
   */
  getPluginAttachments(): ReadonlyMap<string, readonly PluginAttachment[]> {
    return this.pluginAttachments;
  }

  async loadTypes() {
    if (Object.keys(this.rawTypes).length > 0) {
      return this.rawTypes;
    }

    if (!this.config.files || this.config.files.length === 0) {
      return;
    }

    const typeFiles = loadFilesWithIgnores(this.config);

    logger.newline();
    logger.log(
      `Found ${styles.highlight(typeFiles.length.toString())} type files for TailorDB service ${styles.highlight(`"${this.namespace}"`)}`,
    );

    await Promise.all(typeFiles.map((typeFile) => this.loadTypeFile(typeFile)));
    this.parseTypes();
    return this.types;
  }

  async loadTypesForFile(typeFile: string) {
    const result = await this.loadTypeFile(typeFile);
    this.parseTypes();
    return result;
  }

  private async loadTypeFile(typeFile: string) {
    this.rawTypes[typeFile] = {};
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
          this.rawTypes[typeFile][exportedValue.name] = exportedValue;
          loadedTypes[exportedValue.name] = exportedValue;
          // Store source info mapping
          this.typeSourceInfo[exportedValue.name] = {
            filePath: typeFile,
            exportName,
          };

          // Process plugins if any and pluginManager is available
          if (
            exportedValue.plugins &&
            Array.isArray(exportedValue.plugins) &&
            exportedValue.plugins.length > 0
          ) {
            this.pluginAttachments.set(exportedValue.name, [...exportedValue.plugins]);
            logger.log(
              `  Plugin attachments: ${styles.info(exportedValue.plugins.map((p: PluginAttachment) => p.pluginId).join(", "))}`,
            );

            // Process plugins and generate types
            await this.processPluginsForType(exportedValue, exportedValue.plugins, typeFile);
          }
        }
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), typeFile);
      logger.error(`Failed to load type from ${styles.bold(relativePath)}`);
      logger.error(String(error));
      throw error;
    }
    return loadedTypes;
  }

  /**
   * Process plugins for a type and add generated types to rawTypes
   * @param rawType - The raw TailorDB type being processed
   * @param attachments - Plugin attachments for this type
   * @param sourceFilePath - The file path where the type was loaded from
   */
  private async processPluginsForType(
    rawType: TailorDBType,
    attachments: PluginAttachment[],
    sourceFilePath: string,
  ): Promise<void> {
    if (!this.pluginManager) return;

    // Keep track of the current type state for extension across multiple plugins
    let currentType = rawType;

    for (const attachment of attachments) {
      const output = await this.pluginManager.processAttachment({
        type: currentType,
        config: attachment.config,
        namespace: this.namespace,
        pluginId: attachment.pluginId,
      });

      // First, extend the original type with new fields (if any)
      // This must be done before adding generated types, as they may reference extended fields
      if (output.extendFields && Object.keys(output.extendFields).length > 0) {
        currentType = this.extendTypeFields(
          currentType,
          output.extendFields,
          sourceFilePath,
          attachment.pluginId,
        );
        logger.log(
          `  Extended: ${styles.success(currentType.name)} with ${styles.highlight(Object.keys(output.extendFields).length.toString())} fields by plugin ${styles.info(attachment.pluginId)}`,
        );
      }

      // Then add generated types to rawTypes (same file path, but with pluginId marker)
      for (const generatedType of output.types ?? []) {
        this.rawTypes[sourceFilePath][generatedType.name] = generatedType as TailorDBType;
        this.typeSourceInfo[generatedType.name] = {
          filePath: sourceFilePath,
          exportName: generatedType.name,
          pluginId: attachment.pluginId,
        };

        logger.log(
          `  Generated: ${styles.success(generatedType.name)} by plugin ${styles.info(attachment.pluginId)}`,
        );
      }
    }
  }

  /**
   * Extend the fields of a TailorDBType.
   * Creates a new type with merged fields while preserving original metadata.
   * @param rawType - The original TailorDB type to extend
   * @param extendFields - New fields to add to the type
   * @param sourceFilePath - The file path where the type was loaded from
   * @param pluginId - The ID of the plugin extending the type (for error messages)
   * @returns The extended TailorDBType for use in subsequent processing
   * @throws {Error} If extendFields contains fields that already exist in the type
   */
  private extendTypeFields(
    rawType: TailorDBType,
    extendFields: Record<string, unknown>,
    sourceFilePath: string,
    pluginId: string,
  ): TailorDBType {
    // Check for duplicate fields
    const existingFieldNames = Object.keys(rawType.fields);
    const newFieldNames = Object.keys(extendFields);
    const duplicateFields = newFieldNames.filter((name) => existingFieldNames.includes(name));

    if (duplicateFields.length > 0) {
      throw new Error(
        `Plugin "${pluginId}" attempted to add fields that already exist in type "${rawType.name}": ${duplicateFields.join(", ")}. ` +
          `extendFields cannot overwrite existing fields.`,
      );
    }

    // Create new field object with merged fields
    const mergedFields = {
      ...rawType.fields,
      ...extendFields,
    };

    // Create new TailorDBType with merged fields
    // Note: We need to exclude 'id' since db.type() adds it automatically
    const { id: _id, ...fieldsWithoutId } = mergedFields;
    const extendedType = db.type(rawType.name, fieldsWithoutId);

    // Copy metadata from original to extended type
    const result = this.copyMetadataToExtendedType(rawType, extendedType);
    this.rawTypes[sourceFilePath][rawType.name] = result;

    return result;
  }

  /**
   * Copy metadata from original type to extended type.
   * Preserves files, settings, permissions, indexes, and plugins.
   * @param original - The original TailorDB type
   * @param extended - The newly created extended type
   * @returns The extended type with copied metadata
   */
  private copyMetadataToExtendedType(original: TailorDBType, extended: TailorDBType): TailorDBType {
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
        // TypeFeatures uses literal type `true` for boolean flags,
        // but metadata getter returns inferred `boolean | undefined`.
        // Cast is safe since we're copying the same values.
        result = result.features(
          features as typeof features & { aggregation?: true; bulkUpsert?: true },
        );
      }
    }

    // Access private fields for permissions and indexes
    // TypeScript private fields are accessible at runtime
    // oxlint-disable-next-line no-explicit-any
    const originalAny = original as any;

    // Copy permissions
    if (originalAny._permissions?.record) {
      result = result.permission(originalAny._permissions.record);
    }
    if (originalAny._permissions?.gql) {
      result = result.gqlPermission(originalAny._permissions.gql);
    }

    // Copy indexes (using the internal array format, not the metadata format)
    if (originalAny._indexes && originalAny._indexes.length > 0) {
      result = result.indexes(...originalAny._indexes);
    }

    // Copy plugins (but don't re-process them)
    if (originalAny._plugins && originalAny._plugins.length > 0) {
      for (const plugin of originalAny._plugins) {
        result = result.plugin({ [plugin.pluginId]: plugin.config });
      }
    }

    return result;
  }

  private parseTypes() {
    const allTypes: Record<string, TailorDBType> = {};
    for (const fileTypes of Object.values(this.rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        allTypes[typeName] = type;
      }
    }

    this.types = parseTypes(allTypes, this.namespace, this.typeSourceInfo);
  }
}
