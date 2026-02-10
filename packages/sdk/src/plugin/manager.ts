import { db } from "@/configure/services/tailordb";
import { unauthenticatedTailorUser } from "@/configure/types";
import type { TailorAnyField } from "@/configure/types";
import type {
  PluginBase,
  PluginGeneratedExecutor,
  PluginGeneratedType,
  PluginNamespaceGeneratedTypeEntry,
  PluginNamespaceProcessContext,
  PluginOutput,
} from "@/parser/plugin-config/types";
import type { TailorAnyDBType } from "@/parser/service/tailordb/types";

/**
 * Context for processing a single plugin attachment on a raw TailorDBType
 */
export interface ProcessAttachmentContext {
  type: TailorAnyDBType;
  config: unknown;
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
}

/**
 * Extended executor info with plugin import path
 */
export interface PluginExecutorInfoExtended extends PluginExecutorInfo {
  /** Plugin's import path for resolving executor files */
  pluginImportPath: string;
}

/**
 * Result of processing a plugin attachment
 */
export type ProcessAttachmentResult =
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
 * Validation error for plugin config
 */
interface ConfigValidationError {
  field: string;
  message: string;
}

/**
 * Validate plugin config against its schema
 * @param config - The config object to validate
 * @param schema - The schema defining expected fields
 * @returns Array of validation errors (empty if valid)
 */
function validatePluginConfig(config: unknown, schema: TailorAnyField): ConfigValidationError[] {
  const result = schema.parse({
    value: config,
    data: config,
    user: unauthenticatedTailorUser,
  });

  if ("issues" in result && result.issues) {
    return result.issues.map((issue) => ({
      field: Array.isArray(issue.path) ? issue.path.join(".") : "",
      message: issue.message,
    }));
  }

  return [];
}

/**
 * Manages plugin registration and processing
 */
export class PluginManager {
  private plugins: Map<string, PluginBase> = new Map();
  private generatedExecutors: PluginExecutorInfo[] = [];
  private generatedTypes: PluginGeneratedTypeInfo[] = [];
  private namespaceGeneratedTypeKeys: Set<string> = new Set();
  private namespaceGeneratedExecutorKeys: Set<string> = new Set();

  constructor(plugins: PluginBase[] = []) {
    for (const plugin of plugins) {
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

    // Validate config against schema if provided
    if (plugin.configSchema) {
      const validationErrors = validatePluginConfig(context.config, plugin.configSchema);
      if (validationErrors.length > 0) {
        const errorDetails = validationErrors
          .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
          .join("; ");
        return {
          success: false,
          error: `Invalid config for plugin "${plugin.id}" on type "${context.type.name}": ${errorDetails}`,
        };
      }
    }

    // Check if plugin supports type-attached processing
    if (!plugin.process) {
      return {
        success: false,
        error: `Plugin "${plugin.id}" does not support type-attached processing (missing process method). Use processNamespace via definePlugins() instead.`,
      };
    }

    // Execute plugin process with raw TailorDBType
    const output = await plugin.process({
      type: context.type,
      config: context.config,
      pluginConfig: plugin.pluginConfig,
      namespace: context.namespace,
    });

    // Collect generated types
    if (output.types && Object.keys(output.types).length > 0) {
      const importPath = plugin.importPath;
      for (const [kind, type] of Object.entries(output.types)) {
        this.generatedTypes.push({
          pluginId: context.pluginId,
          pluginImportPath: importPath,
          sourceTypeName: context.type.name,
          kind,
          type,
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
   * This method is called once per namespace for plugins with processNamespace method.
   * @param namespace - The target namespace for generated types
   * @param types - TailorDB types in the namespace (after type-attached processing)
   * @param generatedTypes - Plugin-generated types in the namespace
   * @returns Array of results with plugin outputs and configs
   */
  async processNamespacePlugins(
    namespace: string,
    types: TailorAnyDBType[],
    generatedTypes: PluginNamespaceGeneratedTypeEntry[],
  ): Promise<Array<{ pluginId: string; config: unknown; result: ProcessAttachmentResult }>> {
    const results: Array<{ pluginId: string; config: unknown; result: ProcessAttachmentResult }> =
      [];

    for (const [pluginId, plugin] of this.plugins) {
      // Skip plugins without processNamespace method
      if (!plugin.processNamespace) {
        continue;
      }

      // Use stored plugin config (from definePlugins)
      const config = plugin.pluginConfig;

      // Validate plugin config against pluginConfigSchema if provided
      if (plugin.pluginConfigSchema && config !== undefined) {
        const validationErrors = validatePluginConfig(config, plugin.pluginConfigSchema);
        if (validationErrors.length > 0) {
          const errorDetails = validationErrors
            .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
            .join("; ");
          results.push({
            pluginId,
            config,
            result: {
              success: false,
              error: `Invalid pluginConfig for plugin "${plugin.id}": ${errorDetails}`,
            },
          });
          continue;
        }
      }

      // Execute plugin processNamespace
      const context: PluginNamespaceProcessContext = {
        pluginConfig: config,
        namespace,
        types,
        generatedTypes,
      };

      const output = await plugin.processNamespace(context);

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
        const importPath = plugin.importPath;
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
   * Get plugins that have processNamespace method
   * @returns Array of plugin IDs that support namespace processing
   */
  getNamespacePluginIds(): string[] {
    return Array.from(this.plugins.entries())
      .filter(([, plugin]) => plugin.processNamespace !== undefined)
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
  if (metadata.permissions?.record) {
    result = result.permission(metadata.permissions.record);
  }
  if (metadata.permissions?.gql) {
    result = result.gqlPermission(metadata.permissions.gql);
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
