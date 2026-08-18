import * as path from "pathe";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { logger, styles } from "#/cli/shared/logger";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { importUserModule } from "#/cli/shared/user-modules";
import { stripTailorDBTypeBuilderHelpers } from "#/parser/service/tailordb/builder-helpers";
import { parseTypes, TailorDBTypeSchema } from "#/parser/service/tailordb/index";
import {
  findMissingPermissionConfig,
  findOmittedPermitRules,
} from "#/parser/service/tailordb/permission";
import { assertDefined } from "#/utils/assert";
import { isSdkBranded } from "#/utils/brand";
import { precompileTailorDBTypeScripts } from "./hooks-validate-bundler";
import { formatTailorDBTypeSourceInfo } from "./type-name-validation";
import type {
  TypeSourceInfo,
  TypeSourceInfoEntry,
  TailorDBType,
} from "#/parser/service/tailordb/types";
import type { PluginManager } from "#/plugin/manager";
import type { PluginAttachment } from "#/plugin/types";
import type {
  TailorDBServiceConfig,
  TailorDBTypeRaw as TailorDBTypeSchemaOutput,
} from "#/types/tailordb.generated";

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
  /** Directory the config's file patterns are resolved against */
  baseDir: string;
}

/**
 * Creates a new TailorDBService instance.
 * @param params - Parameters for creating the service
 * @returns A new TailorDBService instance
 */
export function createTailorDBService(params: CreateTailorDBServiceParams): TailorDBService {
  const { namespace, config, pluginManager, baseDir } = params;
  type TailorDBTypesByName = Record<string, TailorDBTypeSchemaOutput>;
  const createRawTypesByName = (): TailorDBTypesByName =>
    Object.create(null) as TailorDBTypesByName;
  const rawTypes = Object.create(null) as Record<string, TailorDBTypesByName>;
  let types: Record<string, TailorDBType> = {};
  const typeSourceInfo = Object.create(null) as TypeSourceInfo;
  const pluginAttachments: Map<string, PluginAttachment[]> = new Map();
  let loadPromise: Promise<Record<string, TailorDBType> | undefined> | undefined;

  const registerRawType = (
    rawTypesKey: string,
    typeName: string,
    type: TailorDBTypeSchemaOutput,
    sourceInfo: TypeSourceInfoEntry,
  ): void => {
    const existingSourceInfo = Object.hasOwn(typeSourceInfo, typeName)
      ? typeSourceInfo[typeName]
      : undefined;
    if (existingSourceInfo) {
      const firstSource = formatTailorDBTypeSourceInfo(existingSourceInfo) ?? "unknown source";
      const secondSource = formatTailorDBTypeSourceInfo(sourceInfo) ?? "unknown source";
      throw new Error(
        `Duplicate TailorDB table name "${typeName}" detected in TailorDB service "${namespace}". ` +
          `First: ${firstSource}. Second: ${secondSource}. ` +
          "TailorDB table names must be unique across all TailorDB files in a service.",
      );
    }

    assertDefined(rawTypes[rawTypesKey], `raw table entry missing for key: ${rawTypesKey}`)[
      typeName
    ] = type;
    typeSourceInfo[typeName] = sourceInfo;
  };

  const doParseTypes = (): void => {
    const allTypes = createRawTypesByName();
    for (const fileTypes of Object.values(rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        allTypes[typeName] = type;
      }
    }

    types = parseTypes(allTypes, namespace, typeSourceInfo);
  };

  // Warn about object-format permission rules that omit `permit`. Those default
  // to "deny" (unlike the array shorthand, which defaults to "allow"), an easy
  // way to accidentally lock out access the rule was meant to grant.
  const warnOmittedPermit = (): void => {
    for (const fileTypes of Object.values(rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        const locations = findOmittedPermitRules(type.metadata.permissions);
        if (locations.length > 0) {
          logger.warn(
            `TailorDB table "${typeName}" has permission rule(s) ${locations.join(", ")} in object form without an explicit "permit"; they default to "deny". Set permit: true (allow) or permit: false (deny) to silence this warning.`,
          );
        }
      }
    }
  };

  // Require .permission()/.gqlPermission() to be set explicitly. TailorDB
  // fails closed for record operations without a .permission(), producing an
  // opaque "internal error" instead of a clear denial when only
  // .gqlPermission() is set. Catching the omission here, rather than at
  // deploy/insert time, surfaces it while the table is still local.
  const validateRequiredPermissions = (): void => {
    const errors: string[] = [];
    for (const fileTypes of Object.values(rawTypes)) {
      for (const [typeName, type] of Object.entries(fileTypes)) {
        const effectiveGqlOperations =
          type.metadata.settings?.gqlOperations ?? config.gqlOperations;
        const { missingPermission, missingGqlPermission } = findMissingPermissionConfig(
          type.metadata.permissions,
          effectiveGqlOperations,
        );
        if (!missingPermission && !missingGqlPermission) {
          continue;
        }
        const source = formatTailorDBTypeSourceInfo(typeSourceInfo[typeName]);
        const location = source ? ` (${source})` : "";
        if (missingPermission) {
          errors.push(
            `TailorDB table "${typeName}"${location} has no .permission() configured. TailorDB denies all record operations for tables without permission; call .permission(...) to grant access explicitly.`,
          );
        }
        if (missingGqlPermission) {
          errors.push(
            `TailorDB table "${typeName}"${location} has no .gqlPermission() configured, but GraphQL operations are enabled for it. Call .gqlPermission(...) to grant GraphQL access explicitly, or disable GraphQL exposure with .features({ gqlOperations: { create: false, update: false, delete: false, read: false } }).`,
          );
        }
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `TailorDB permission configuration errors in service "${namespace}":\n${errors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }
  };

  /**
   * Process plugins for a table and add generated tables to rawTypes
   * @param rawTable - The raw TailorDB table being processed
   * @param attachments - Plugin attachments for this table
   * @param sourceFilePath - The file path where the table was loaded from
   */
  const processPluginsForTable = async (
    rawTable: TailorDBTypeSchemaOutput,
    attachments: PluginAttachment[],
    sourceFilePath: string,
  ): Promise<void> => {
    if (!pluginManager) return;

    const { extendedTable, generatedTables, events } =
      await pluginManager.processAttachmentsForTable({
        rawTable,
        attachments,
        namespace,
      });

    if (extendedTable) {
      assertDefined(
        rawTypes[sourceFilePath],
        `raw table entry missing for file: ${sourceFilePath}`,
      )[rawTable.name] = extendedTable;
    }
    for (const generatedTable of generatedTables) {
      // Plugin-generated tables don't have a source file.
      // Generators that need to import these tables should generate their own type files.
      const sourceInfo: TypeSourceInfoEntry = {
        exportName: generatedTable.tableName,
        pluginId: generatedTable.pluginId,
        pluginImportPath: generatedTable.pluginImportPath,
        originalFilePath: sourceFilePath,
        originalExportName: typeSourceInfo[rawTable.name]?.exportName || rawTable.name,
        generatedTableKind: generatedTable.kind,
        pluginConfig: generatedTable.pluginConfig,
        namespace,
      };
      registerRawType(sourceFilePath, generatedTable.tableName, generatedTable.table, sourceInfo);
    }
    for (const ev of events) {
      if (ev.kind === "extended") {
        logger.log(
          `  Extended: ${styles.success(ev.tableName)} with ${styles.highlight(ev.fieldCount.toString())} fields by plugin ${styles.info(ev.pluginId)}`,
        );
      } else {
        logger.log(
          `  Generated: ${styles.success(ev.tableName)} by plugin ${styles.info(ev.pluginId)}`,
        );
      }
    }
  };

  const loadTypeFile = async (
    typeFile: string,
    tsconfig: string | undefined,
  ): Promise<TailorDBTypesByName> => {
    rawTypes[typeFile] = createRawTypesByName();
    const loadedTypes = createRawTypesByName();
    try {
      const module = await importUserModule(typeFile);

      for (const exportName of Object.keys(module)) {
        const exportedValue = module[exportName];

        const result = TailorDBTypeSchema.safeParse(stripTailorDBTypeBuilderHelpers(exportedValue));
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
        loadedTypes[result.data.name] = result.data;
        registerRawType(typeFile, result.data.name, result.data, {
          filePath: typeFile,
          exportName,
        });

        // Process plugins if any
        const rawType = exportedValue as TailorDBTypeSchemaOutput & {
          plugins?: PluginAttachment[];
        };
        if (rawType.plugins && Array.isArray(rawType.plugins) && rawType.plugins.length > 0) {
          pluginAttachments.set(rawType.name, [...rawType.plugins]);
          logger.log(
            `  Plugin attachments: ${styles.info(rawType.plugins.map((p) => p.pluginId).join(", "))}`,
          );

          await processPluginsForTable(rawType, rawType.plugins, typeFile);
        }
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), typeFile);
      logger.error(`Failed to load table from ${styles.bold(relativePath)}`);
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
          if (config.files.length === 0) {
            return undefined;
          }

          const typeFiles = [...new Set(loadFilesWithIgnores(config, baseDir))];

          const tsconfig = await resolveTSConfigWithFallback(baseDir);

          logger.newline();
          logger.log(
            `Found ${styles.highlight(typeFiles.length.toString())} table files for TailorDB service ${styles.highlight(`"${namespace}"`)}`,
          );

          if (pluginManager) {
            for (const typeFile of typeFiles) {
              await loadTypeFile(typeFile, tsconfig);
            }
          } else {
            await Promise.all(typeFiles.map((typeFile) => loadTypeFile(typeFile, tsconfig)));
          }
          doParseTypes();
          warnOmittedPermit();
          validateRequiredPermissions();
          return types;
        })();
      }
      return loadPromise;
    },
    processNamespacePlugins: async () => {
      if (!pluginManager) return;

      const results = await pluginManager.processNamespacePlugins(namespace);
      const pluginGeneratedKey = "__plugin_generated__";

      const successfulResults = results.map(({ pluginId, config, result }) => {
        if (!result.success) {
          logger.error(result.error);
          throw new Error(result.error);
        }
        return { pluginId, config, output: result.output };
      });

      const hasPreviousGeneratedTables = Object.hasOwn(rawTypes, pluginGeneratedKey);
      const previousGeneratedTables = rawTypes[pluginGeneratedKey];
      const previousGeneratedTableKeys = previousGeneratedTables
        ? Object.keys(previousGeneratedTables)
        : [];
      const hadPreviousGeneratedTables = previousGeneratedTableKeys.length > 0;
      if (hasPreviousGeneratedTables) {
        for (const tableName of previousGeneratedTableKeys) {
          delete typeSourceInfo[tableName];
        }
      }
      rawTypes[pluginGeneratedKey] = createRawTypesByName();

      let hasGeneratedTables = false;
      for (const { pluginId, config, output } of successfulResults) {
        // Add generated tables to rawTypes
        for (const [kind, generatedTable] of Object.entries(output.tables ?? {})) {
          const sourceInfo: TypeSourceInfoEntry = {
            exportName: generatedTable.name,
            pluginId,
            pluginImportPath: pluginManager.getPluginImportPath(pluginId) ?? "",
            originalFilePath: "",
            originalExportName: "",
            generatedTableKind: kind,
            pluginConfig: config,
            namespace,
          };
          registerRawType(
            pluginGeneratedKey,
            generatedTable.name,
            generatedTable as TailorDBTypeSchemaOutput,
            sourceInfo,
          );
          hasGeneratedTables = true;

          logger.log(
            `  Generated: ${styles.success(generatedTable.name)} by namespace plugin ${styles.info(pluginId)}`,
          );
        }
      }

      // Re-parse tables to include namespace plugin tables
      if (hasGeneratedTables || hadPreviousGeneratedTables) {
        doParseTypes();
        validateRequiredPermissions();
      }
    },
  };
}
