import { unauthenticatedTailorUser } from "@/configure/types";
import type { TailorAnyField } from "@/configure/types";
import type {
  PluginBase,
  PluginOutput,
  StandalonePluginProcessContext,
} from "@/parser/plugin-config/types";
import type { TailorDBType } from "@/parser/service/tailordb/types";

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
}
