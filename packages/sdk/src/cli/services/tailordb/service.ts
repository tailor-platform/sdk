import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import { loadFilesWithIgnores } from "@/cli/services/file-loader";
import { logger, styles } from "@/cli/shared/logger";
import { parseTypes, TailorDBTypeSchema } from "@/parser/service/tailordb";
import { isSdkBranded } from "@/utils/brand";
import { precompileTailorDBTypeScripts } from "./hooks-validate-bundler";
import type { PluginManager } from "@/plugin/manager";
import type { PluginAttachment } from "@/types/plugin";
import type { TypeSourceInfo, TailorDBType } from "@/types/tailordb";
import type {
  TailorDBServiceConfig,
  TailorDBTypeRaw as TailorDBTypeSchemaOutput,
} from "@/types/tailordb.generated";

export type TailorDBService = {
  readonly namespace: string;
  readonly config: TailorDBServiceConfig;
  readonly types: Readonly<Record<string, TailorDBType>>;
  readonly typeSourceInfo: Readonly<TypeSourceInfo>;
  readonly pluginAttachments: ReadonlyMap<string, readonly PluginAttachment[]>;
  loadTypes: () => Promise<Record<string, TailorDBType> | undefined>;
  processNamespacePlugins: () => Promise<void>;
};

/**
 * Parameters for creating a TailorDBService
 */
export interface CreateTailorDBServiceParams {
  /** The namespace for this TailorDB service */
  namespace: string;
  /** The TailorDB service configuration */
  config: TailorDBServiceConfig;
  /** Plugin manager for processing plugins */
  pluginManager?: PluginManager;
}

/**
 * Creates a new TailorDBService instance.
 * @param params - Parameters for creating the service
 * @returns A new TailorDBService instance
 */
export function createTailorDBService(params: CreateTailorDBServiceParams): TailorDBService {
  const { namespace, config, pluginManager } = params;
  type TailorDBTypesByName = Record<string, TailorDBTypeSchemaOutput>;
  const rawTypes: Record<string, TailorDBTypesByName> = {};
  let types: Record<string, TailorDBType> = {};
  const typeSourceInfo: TypeSourceInfo = {};
  const pluginAttachments: Map<string, PluginAttachment[]> = new Map();
  let loadPromise: Promise<Record<string, TailorDBType> | undefined> | undefined;

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
    rawType: TailorDBTypeSchemaOutput,
    attachments: PluginAttachment[],
    sourceFilePath: string,
  ): Promise<void> => {
    if (!pluginManager) return;

    const { extendedType, generatedTypes, events } = await pluginManager.processAttachmentsForType({
      rawType,
      attachments,
      namespace,
    });

    if (extendedType) {
      rawTypes[sourceFilePath][rawType.name] = extendedType;
    }
    for (const gen of generatedTypes) {
      // Plugin-generated types don't have a source file.
      // Generators that need to import these types should generate their own type files.
      rawTypes[sourceFilePath][gen.typeName] = gen.type;
      typeSourceInfo[gen.typeName] = {
        exportName: gen.typeName,
        pluginId: gen.pluginId,
        pluginImportPath: gen.pluginImportPath,
        originalFilePath: sourceFilePath,
        originalExportName: typeSourceInfo[rawType.name]?.exportName || rawType.name,
        generatedTypeKind: gen.kind,
        pluginConfig: gen.pluginConfig,
        namespace,
      };
    }
    for (const ev of events) {
      if (ev.kind === "extended") {
        logger.log(
          `  Extended: ${styles.success(ev.typeName)} with ${styles.highlight(ev.fieldCount.toString())} fields by plugin ${styles.info(ev.pluginId)}`,
        );
      } else {
        logger.log(
          `  Generated: ${styles.success(ev.typeName)} by plugin ${styles.info(ev.pluginId)}`,
        );
      }
    }
  };

  const loadTypeFile = async (
    typeFile: string,
    tsconfig: string | undefined,
  ): Promise<TailorDBTypesByName> => {
    rawTypes[typeFile] = {};
    const loadedTypes: TailorDBTypesByName = {};
    try {
      const module = await import(pathToFileURL(typeFile).href);

      for (const exportName of Object.keys(module)) {
        const exportedValue = module[exportName];

        const result = TailorDBTypeSchema.safeParse(exportedValue);
        if (!result.success) {
          if (isSdkBranded(exportedValue, "tailordb-type")) {
            throw result.error;
          }
          continue;
        }

        const relativePath = path.relative(process.cwd(), typeFile);
        logger.log(
          `Type: ${styles.successBright(`"${result.data.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        await precompileTailorDBTypeScripts(result.data, typeFile, tsconfig);
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
    get types() {
      return types;
    },
    get typeSourceInfo() {
      return typeSourceInfo;
    },
    get pluginAttachments() {
      return pluginAttachments as ReadonlyMap<string, readonly PluginAttachment[]>;
    },
    loadTypes: async () => {
      if (!loadPromise) {
        loadPromise = (async () => {
          if (!config.files || config.files.length === 0) {
            return undefined;
          }

          const typeFiles = loadFilesWithIgnores(config);

          let tsconfig: string | undefined;
          try {
            tsconfig = await resolveTSConfig();
          } catch {
            tsconfig = undefined;
          }

          logger.newline();
          logger.log(
            `Found ${styles.highlight(typeFiles.length.toString())} type files for TailorDB service ${styles.highlight(`"${namespace}"`)}`,
          );

          if (pluginManager) {
            for (const typeFile of typeFiles) {
              await loadTypeFile(typeFile, tsconfig);
            }
          } else {
            await Promise.all(typeFiles.map((typeFile) => loadTypeFile(typeFile, tsconfig)));
          }
          doParseTypes();
          return types;
        })();
      }
      return loadPromise;
    },
    processNamespacePlugins: async () => {
      if (!pluginManager) return;

      const results = await pluginManager.processNamespacePlugins(namespace);
      const pluginGeneratedKey = "__plugin_generated__";

      if (!rawTypes[pluginGeneratedKey]) {
        rawTypes[pluginGeneratedKey] = {};
      }

      let hasGeneratedTypes = false;
      for (const { pluginId, config, result } of results) {
        if (!result.success) {
          logger.error(result.error);
          throw new Error(result.error);
        }

        const output = result.output;

        // Add generated types to rawTypes
        for (const [kind, generatedType] of Object.entries(output.types ?? {})) {
          rawTypes[pluginGeneratedKey][generatedType.name] =
            generatedType as TailorDBTypeSchemaOutput;
          hasGeneratedTypes = true;
          typeSourceInfo[generatedType.name] = {
            exportName: generatedType.name,
            pluginId,
            pluginImportPath: pluginManager.getPluginImportPath(pluginId) ?? "",
            originalFilePath: "",
            originalExportName: "",
            generatedTypeKind: kind,
            pluginConfig: config,
            namespace,
          };

          logger.log(
            `  Generated: ${styles.success(generatedType.name)} by namespace plugin ${styles.info(pluginId)}`,
          );
        }
      }

      // Re-parse types to include namespace plugin types
      if (hasGeneratedTypes) {
        doParseTypes();
      }
    },
  };
}
