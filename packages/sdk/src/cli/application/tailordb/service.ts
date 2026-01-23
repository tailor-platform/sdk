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

    for (const attachment of attachments) {
      const output = await this.pluginManager.processAttachment({
        type: rawType,
        config: attachment.config,
        namespace: this.namespace,
        pluginId: attachment.pluginId,
      });

      // Add generated types to rawTypes (same file path, but with pluginId marker)
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
