import { logger, styles } from "@/cli/utils/logger";
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
   * @returns Plugin output with generated types, resolvers, and executors
   */
  async processAttachment(context: ProcessAttachmentContext): Promise<PluginOutput> {
    const plugin = this.plugins.get(context.pluginId);
    if (!plugin) {
      logger.warn(`Plugin "${styles.warning(context.pluginId)}" not found`);
      return { types: [] };
    }

    // Validate config against schema if provided
    if (plugin.configSchema) {
      const validationErrors = validatePluginConfig(context.config, plugin.configSchema);
      if (validationErrors.length > 0) {
        logger.error(
          `Invalid config for plugin ${styles.error(plugin.id)} on type "${styles.highlight(context.type.name)}":`,
        );
        for (const error of validationErrors) {
          const fieldPrefix = error.field ? `${error.field}: ` : "";
          logger.error(`  ${fieldPrefix}${error.message}`);
        }
        throw new Error(
          `Plugin config validation failed for "${plugin.id}" on type "${context.type.name}"`,
        );
      }
    }

    // Execute plugin process with raw TailorDBType
    return await plugin.process({
      type: context.type,
      config: context.config,
      namespace: context.namespace,
    });
  }

  /**
   * Get the count of registered plugins
   * @returns Number of registered plugins
   */
  get pluginCount(): number {
    return this.plugins.size;
  }
}
