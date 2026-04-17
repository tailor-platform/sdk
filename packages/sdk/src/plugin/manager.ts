import { db } from "@/parser/service/tailordb/runtime";
import { hasGenerationHooks, getPluginGenerationDependencies } from "@/types/plugin-generation";
import type { TailorAnyDBType } from "@/configure/services/tailordb";
import type {
  TailorTypePermission,
  TailorTypeGqlPermission,
} from "@/configure/services/tailordb/permission";
import type { DependencyKind } from "@/parser/generator-config/schema";
import type {
  Plugin,
  PluginGeneratedExecutor,
  PluginGeneratedType,
  PluginNamespaceProcessContext,
  PluginOutput,
  TypePluginOutput,
} from "@/types/plugin";

/**
 * Context for processing a single plugin attachment on a raw TailorDBType
 */
export interface ProcessAttachmentContext {
  type: TailorAnyDBType;
  typeConfig: unknown;
  namespace: string;
  pluginId: string;
}

/**
 * Information about a plugin-generated type (for type file generation)
 */
export interface PluginGeneratedTypeInfo {
  /** Plugin ID that generated this type */
  pluginId: string;
  /** Plugin import path for resolving executor files */
  pluginImportPath: string;
  /** Source type name that triggered the plugin */
  sourceTypeName: string;
  /** Kind identifier for this generated type */
  kind: string;
  /** The generated TailorDB type object */
  type: PluginGeneratedType;
  /** Namespace where this type was generated */
  namespace: string;
  /** Plugin config used to generate this type */
  pluginConfig?: unknown;
}

/**
 * Extended executor info with plugin import path
 */
export interface PluginExecutorInfoExtended extends PluginExecutorInfo {
  /** Plugin's import path for resolving executor files */
  pluginImportPath: string;
}

/**
 * Result of processing a type-attached plugin
 */
export type ProcessAttachmentResult =
  | { success: true; output: TypePluginOutput }
  | { success: false; error: string };

/**
 * Result of processing a namespace plugin
 */
export type ProcessNamespaceResult =
  | { success: true; output: PluginOutput }
  | { success: false; error: string };

/**
 * Information about a plugin-generated executor
 */
export interface PluginExecutorInfo {
  /** The executor definition */
  executor: PluginGeneratedExecutor;
  /** Plugin ID that generated this executor */
  pluginId: string;
  /** Namespace where the executor was generated */
  namespace: string;
  /** Source type name (for type-attached executors, undefined for namespace) */
  sourceTypeName?: string;
}

/**
 * Manages plugin registration and processing
 */
export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private generatedExecutors: PluginExecutorInfo[] = [];
  private generatedTypes: PluginGeneratedTypeInfo[] = [];
  private namespaceGeneratedTypeKeys: Set<string> = new Set();
  private namespaceGeneratedExecutorKeys: Set<string> = new Set();

  /** Generated plugin executor file paths */
  private pluginExecutorFiles: string[] = [];

  constructor(plugins: Plugin[] = []) {
    for (const plugin of plugins) {
      if (this.plugins.has(plugin.id)) {
        throw new Error(
          `Duplicate plugin ID "${plugin.id}" detected. Each plugin must have a unique ID.`,
        );
      }
      this.plugins.set(plugin.id, plugin);
    }
  }

  /**
   * Process a single plugin attachment on a raw TailorDBType.
   * This method is called during type loading before parsing.
   * @param context - Context containing the raw type, config, namespace, and plugin ID
   * @returns Result with plugin output on success, or error message on failure
   */
  async processAttachment(context: ProcessAttachmentContext): Promise<ProcessAttachmentResult> {
    const plugin = this.plugins.get(context.pluginId);
    if (!plugin) {
      return {
        success: false,
        error: `Plugin "${context.pluginId}" not found`,
      };
    }

    const typeConfigRequired = plugin.typeConfigRequired;
    const resolvedRequired =
      typeof typeConfigRequired === "function"
        ? typeConfigRequired(plugin.pluginConfig)
        : typeConfigRequired === true;
    if (resolvedRequired && (context.typeConfig === undefined || context.typeConfig === null)) {
      return {
        success: false,
        error: `Plugin "${plugin.id}" requires typeConfig, but none was provided for type "${context.type.name}".`,
      };
    }

    // Check if plugin supports type-attached processing
    if (!plugin.onTypeLoaded) {
      return {
        success: false,
        error: `Plugin "${plugin.id}" does not support type-attached processing (missing onTypeLoaded method). Use onNamespaceLoaded via definePlugins() instead.`,
      };
    }

    // Execute plugin onTypeLoaded with raw TailorDBType
    let output: TypePluginOutput;
    try {
      output = await plugin.onTypeLoaded({
        type: context.type,
        typeConfig: context.typeConfig,
        pluginConfig: plugin.pluginConfig,
        namespace: context.namespace,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Plugin "${plugin.id}" threw an error while processing type "${context.type.name}": ${message}`,
      };
    }

    // Collect generated types
    if (output.types && Object.keys(output.types).length > 0) {
      // importPath is guaranteed by schema validation for plugins with definition-time hooks
      const importPath = plugin.importPath!;
      for (const [kind, type] of Object.entries(output.types)) {
        this.generatedTypes.push({
          pluginId: context.pluginId,
          pluginImportPath: importPath,
          sourceTypeName: context.type.name,
          kind,
          type,
          namespace: context.namespace,
          pluginConfig: plugin.pluginConfig,
        });
      }
    }

    // Collect generated executors
    if (output.executors && output.executors.length > 0) {
      for (const executor of output.executors) {
        this.generatedExecutors.push({
          executor,
          pluginId: context.pluginId,
          namespace: context.namespace,
          sourceTypeName: context.type.name,
        });
      }
    }

    return { success: true, output };
  }

  /**
   * Process namespace plugins that don't require a source type.
   * This method is called once per namespace for plugins with onNamespaceLoaded method.
   * @param namespace - The target namespace for generated types
   * @returns Array of results with plugin outputs and configs
   */
  async processNamespacePlugins(
    namespace: string,
  ): Promise<Array<{ pluginId: string; config: unknown; result: ProcessNamespaceResult }>> {
    const results: Array<{ pluginId: string; config: unknown; result: ProcessNamespaceResult }> =
      [];

    for (const [pluginId, plugin] of this.plugins) {
      // Skip plugins without onNamespaceLoaded method
      if (!plugin.onNamespaceLoaded) {
        continue;
      }

      // Use stored plugin config (from definePlugins)
      const config = plugin.pluginConfig;

      // Execute plugin onNamespaceLoaded
      const context: PluginNamespaceProcessContext = {
        pluginConfig: config,
        namespace,
      };

      let output: Awaited<ReturnType<NonNullable<Plugin["onNamespaceLoaded"]>>>;
      try {
        output = await plugin.onNamespaceLoaded(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          pluginId,
          config,
          result: {
            success: false,
            error: `Plugin "${plugin.id}" threw an error during namespace processing for "${namespace}": ${message}`,
          },
        });
        continue;
      }

      // Collect generated executors (namespace - no source type)
      if (output.executors && output.executors.length > 0) {
        for (const executor of output.executors) {
          const executorKey = `${pluginId}:${executor.name}`;
          if (this.namespaceGeneratedExecutorKeys.has(executorKey)) {
            continue;
          }
          this.namespaceGeneratedExecutorKeys.add(executorKey);
          this.generatedExecutors.push({
            executor,
            pluginId,
            namespace,
          });
        }
      }

      // Collect generated types (namespace - no source type)
      if (output.types && Object.keys(output.types).length > 0) {
        // importPath is guaranteed by schema validation for plugins with definition-time hooks
        const importPath = plugin.importPath!;
        for (const [kind, type] of Object.entries(output.types)) {
          const typeKey = `${pluginId}:${kind}:${type.name}`;
          if (this.namespaceGeneratedTypeKeys.has(typeKey)) {
            continue;
          }
          this.namespaceGeneratedTypeKeys.add(typeKey);
          this.generatedTypes.push({
            pluginId,
            pluginImportPath: importPath,
            sourceTypeName: "(namespace)",
            kind,
            type,
            namespace,
            pluginConfig: plugin.pluginConfig,
          });
        }
      }

      results.push({
        pluginId,
        config,
        result: { success: true, output },
      });
    }

    return results;
  }

  /**
   * Get plugins that have onNamespaceLoaded method
   * @returns Array of plugin IDs that support namespace processing
   */
  getNamespacePluginIds(): string[] {
    return Array.from(this.plugins.entries())
      .filter(([, plugin]) => plugin.onNamespaceLoaded !== undefined)
      .map(([id]) => id);
  }

  /**
   * Get the count of registered plugins
   * @returns Number of registered plugins
   */
  get pluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Get a plugin by its ID
   * @param pluginId - The plugin ID to look up
   * @returns The plugin instance, or undefined if not found
   */
  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get the import path for a plugin
   * @param pluginId - The plugin ID to look up
   * @returns The plugin's import path, or undefined if not found
   */
  getPluginImportPath(pluginId: string): string | undefined {
    return this.plugins.get(pluginId)?.importPath;
  }

  /**
   * Get all plugin-generated executors
   * @returns Array of plugin-generated executor info
   */
  getPluginGeneratedExecutors(): ReadonlyArray<PluginExecutorInfo> {
    return this.generatedExecutors;
  }

  /**
   * Get all plugin-generated executors with import paths
   * @returns Array of plugin-generated executor info with import paths
   */
  getPluginGeneratedExecutorsWithImportPath(): ReadonlyArray<PluginExecutorInfoExtended> {
    return this.generatedExecutors.map((info) => ({
      ...info,
      pluginImportPath: this.getPluginImportPath(info.pluginId) ?? "",
    }));
  }

  /**
   * Get all plugin-generated types
   * @returns Array of plugin-generated type info
   */
  getPluginGeneratedTypes(): ReadonlyArray<PluginGeneratedTypeInfo> {
    return this.generatedTypes;
  }

  /**
   * Get plugin-generated executors for a specific namespace
   * @param namespace - The namespace to filter by
   * @returns Array of plugin-generated executor info for the namespace
   */
  getPluginGeneratedExecutorsForNamespace(namespace: string): ReadonlyArray<PluginExecutorInfo> {
    return this.generatedExecutors.filter((info) => info.namespace === namespace);
  }

  /**
   * Get plugins that have any generation-time hooks.
   * @returns Array of plugins with generation hooks
   */
  getPluginsWithGenerationHooks(): Plugin[] {
    return Array.from(this.plugins.values()).filter((plugin) => hasGenerationHooks(plugin));
  }

  /**
   * Get the generation-time dependencies for a specific plugin.
   * @param pluginId - The plugin ID to look up
   * @returns Set of dependency kinds, or empty set if plugin not found
   */
  getPluginGenerationDependencies(pluginId: string): Set<DependencyKind> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return new Set();
    return getPluginGenerationDependencies(plugin);
  }

  /**
   * Generate plugin files (types and executors) and store the executor file paths.
   * @param params - Parameters for file generation
   * @returns Generated executor file paths
   */
  generatePluginFiles(params: GeneratePluginFilesParams): string[] {
    const { outputDir, sourceTypeInfoMap, configPath, typeGenerator, executorGenerator } = params;

    // Generate type files
    const typeGenerationResult = typeGenerator(this.generatedTypes, outputDir);

    // Generate executor files
    const pluginExecutors = this.getPluginGeneratedExecutorsWithImportPath();
    this.pluginExecutorFiles = executorGenerator(
      pluginExecutors,
      outputDir,
      typeGenerationResult,
      sourceTypeInfoMap,
      configPath,
    );

    return this.pluginExecutorFiles;
  }

  /**
   * Extend a TailorDB type with new fields.
   * This method handles the `db.type()` call and metadata copying internally.
   * @param params - Parameters for type extension
   * @returns The extended TailorDB type
   */
  extendType(params: ExtendTypeParams): TailorAnyDBType {
    const { originalType, extendFields, pluginId } = params;
    const existingFieldNames = Object.keys(originalType.fields);
    const newFieldNames = Object.keys(extendFields);
    const duplicateFields = newFieldNames.filter((name) => existingFieldNames.includes(name));

    if (duplicateFields.length > 0) {
      throw new Error(
        `Plugin "${pluginId}" attempted to add fields that already exist in type "${originalType.name}": ${duplicateFields.join(", ")}. ` +
          `extendFields cannot overwrite existing fields.`,
      );
    }

    const mergedFields = {
      ...originalType.fields,
      ...extendFields,
    };

    const { id: _id, ...fieldsWithoutId } = mergedFields;
    const pluralForm = originalType.metadata.settings?.pluralForm;
    const typeName = pluralForm
      ? ([originalType.name, pluralForm] as [string, string])
      : originalType.name;
    const extendedType = db.type(typeName, fieldsWithoutId);
    return copyMetadataToExtendedType(originalType, extendedType);
  }
}

/**
 * Source info for user-defined types
 */
export type SourceTypeInfo = {
  filePath: string;
  exportName: string;
};

/**
 * Result of generating plugin type files
 */
export interface PluginTypeGenerationResult {
  /** Map of type name to generated file path (relative to outputDir) */
  typeFilePaths: Map<string, string>;
  /** List of all generated file paths (absolute) */
  generatedFiles: string[];
}

/**
 * Parameters for generating plugin files
 */
export interface GeneratePluginFilesParams {
  /** Base output directory (e.g., .tailor-sdk/plugin) */
  outputDir: string;
  /** Map of source type names to their source info */
  sourceTypeInfoMap: Map<string, SourceTypeInfo>;
  /** Path to tailor.config.ts (used for resolving plugin import paths) */
  configPath: string;
  /** Function to generate type files */
  typeGenerator: (
    types: ReadonlyArray<PluginGeneratedTypeInfo>,
    outputDir: string,
  ) => PluginTypeGenerationResult;
  /** Function to generate executor files */
  executorGenerator: (
    executors: ReadonlyArray<PluginExecutorInfoExtended>,
    outputDir: string,
    typeGenerationResult: PluginTypeGenerationResult,
    sourceTypeInfoMap: Map<string, SourceTypeInfo>,
    configPath: string,
  ) => string[];
}

/**
 * Parameters for extending a TailorDB type
 */
export interface ExtendTypeParams {
  /** The original TailorDB type to extend */
  originalType: TailorAnyDBType;
  /** New fields to add to the type */
  extendFields: Record<string, unknown>;
  /** The ID of the plugin extending the type */
  pluginId: string;
}

/**
 * Copy metadata from original type to extended type.
 * Preserves files, settings, permissions, indexes, and plugins.
 * @param original - The original TailorDB type with metadata
 * @param extended - The newly created extended type
 * @returns The extended type with copied metadata
 */
function copyMetadataToExtendedType(
  original: TailorAnyDBType,
  extended: TailorAnyDBType,
): TailorAnyDBType {
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

  // Copy permissions from metadata
  // Zod schema operand types are wider unions than the configure layer's discriminated PermissionCondition,
  // so type assertions are needed here.
  if (metadata.permissions?.record) {
    result = result.permission(metadata.permissions.record as TailorTypePermission);
  }
  if (metadata.permissions?.gql) {
    result = result.gqlPermission(metadata.permissions.gql as TailorTypeGqlPermission);
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
  if (original.plugins && original.plugins.length > 0) {
    for (const plugin of original.plugins) {
      // Use type assertion as plugin ID is dynamic at runtime
      result = result.plugin({
        [plugin.pluginId]: plugin.config,
      } as Parameters<typeof result.plugin>[0]);
    }
  }

  return result;
}
