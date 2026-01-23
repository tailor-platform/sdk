import { unauthenticatedTailorUser } from "@/configure/types";
import type { TailorAnyField } from "@/configure/types";
import type { PluginBase, PluginOutput } from "@/parser/plugin-config/types";
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

    // Execute plugin process with raw TailorDBType
    const output = await plugin.process({
      type: context.type,
      config: context.config,
      namespace: context.namespace,
    });

    return { success: true, output };
  }

  /**
   * Get the count of registered plugins
   * @returns Number of registered plugins
   */
  get pluginCount(): number {
    return this.plugins.size;
  }
}
