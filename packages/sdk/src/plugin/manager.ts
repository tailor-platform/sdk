import { db } from "@/configure/services/tailordb";
import { unauthenticatedTailorUser } from "@/configure/types";
import type { TailorAnyDBType } from "@/configure/services/tailordb";
import type { TailorAnyField } from "@/configure/types";
import type {
  PluginBase,
  PluginOutput,
  StandalonePluginProcessContext,
} from "@/parser/plugin-config/types";
import type { TailorDBTypeConfig as TailorDBType } from "@/parser/service/tailordb/types";

/**
 * Context for processing a single plugin attachment on a raw TailorDBType
 */
export interface ProcessAttachmentContext {
  type: TailorDBType;
  config: unknown;
  namespace: string;
  pluginId: string;
}

/**
 * Result of processing a plugin attachment
 */
export type ProcessAttachmentResult =
  | { success: true; output: PluginOutput }
  | { success: false; error: string };

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
        error: `Plugin "${plugin.id}" does not support type-attached processing (missing process method). Use processStandalone via definePlugins() instead.`,
      };
    }

    // Execute plugin process with raw TailorDBType
    const output = await plugin.process({
      type: context.type,
      config: context.config,
      namespace: context.namespace,
    });

    return { success: true, output };
  }

  /**
   * Process standalone plugins that don't require a source type.
   * This method is called once per namespace for plugins with processStandalone method.
   * @param namespace - The target namespace for generated types
   * @returns Array of results with plugin outputs
   */
  async processStandalonePlugins(
    namespace: string,
  ): Promise<Array<{ pluginId: string; result: ProcessAttachmentResult }>> {
    const results: Array<{ pluginId: string; result: ProcessAttachmentResult }> = [];

    for (const [pluginId, plugin] of this.plugins) {
      // Skip plugins without processStandalone method
      if (!plugin.processStandalone) {
        continue;
      }

      // Validate config against schema if provided
      // For standalone plugins, we use the plugin's own configSchema as default config
      const config = true; // Default config for standalone processing
      if (plugin.configSchema) {
        const validationErrors = validatePluginConfig(config, plugin.configSchema);
        if (validationErrors.length > 0) {
          const errorDetails = validationErrors
            .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
            .join("; ");
          results.push({
            pluginId,
            result: {
              success: false,
              error: `Invalid config for standalone plugin "${plugin.id}": ${errorDetails}`,
            },
          });
          continue;
        }
      }

      // Execute plugin processStandalone
      const context: StandalonePluginProcessContext = {
        config,
        namespace,
      };

      const output = await plugin.processStandalone(context);
      results.push({
        pluginId,
        result: { success: true, output },
      });
    }

    return results;
  }

  /**
   * Get plugins that have processStandalone method
   * @returns Array of plugin IDs that support standalone processing
   */
  getStandalonePluginIds(): string[] {
    return Array.from(this.plugins.entries())
      .filter(([, plugin]) => plugin.processStandalone !== undefined)
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
    const extendedType = db.type(originalType.name, fieldsWithoutId);
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
}
