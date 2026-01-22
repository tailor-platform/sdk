import { logger, styles } from "@/cli/utils/logger";
import { t, unauthenticatedTailorUser } from "@/configure/types";
import type { TailorAnyField } from "@/configure/types";
import type {
  PluginBase,
  PluginOutput,
  PluginGeneratedType,
  PluginGeneratedResolver,
  PluginGeneratedExecutor,
  PluginAttachment,
} from "@/parser/plugin-config/types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

/**
 * Type attachment linking a type to its plugin configuration
 */
export interface PluginTypeAttachment {
  type: ParsedTailorDBType;
  namespace: string;
  pluginId: string;
  config: unknown;
}

/**
 * Aggregated output from all plugin processing
 */
export interface AggregatedPluginOutput {
  types: Map<string, PluginGeneratedType>;
  resolvers: Map<string, PluginGeneratedResolver>;
  executors: Map<string, PluginGeneratedExecutor>;
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
function validatePluginConfig(
  config: unknown,
  schema: Record<string, TailorAnyField>,
): ConfigValidationError[] {
  const objectSchema = t.object(schema);
  const result = objectSchema.parse({
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
  private typeAttachments: PluginTypeAttachment[] = [];

  constructor(plugins: PluginBase[] = []) {
    for (const plugin of plugins) {
      this.plugins.set(plugin.id, plugin);
    }
  }

  /**
   * Register a type attachment for later processing
   * @param attachment - Type attachment to register
   */
  registerTypeAttachment(attachment: PluginTypeAttachment): void {
    this.typeAttachments.push(attachment);
  }

  /**
   * Register all type attachments from a TailorDB service
   * @param types - Parsed types from the service
   * @param namespace - Namespace of the service
   * @param attachments - Plugin attachments map from the service
   */
  registerFromService(
    types: Record<string, ParsedTailorDBType>,
    namespace: string,
    attachments: ReadonlyMap<string, readonly PluginAttachment[]>,
  ): void {
    for (const [typeName, type] of Object.entries(types)) {
      const typeAttachments = attachments.get(typeName);
      if (!typeAttachments || typeAttachments.length === 0) {
        continue;
      }

      for (const attachment of typeAttachments) {
        this.registerTypeAttachment({
          type,
          namespace,
          pluginId: attachment.pluginId,
          config: attachment.config,
        });
      }
    }
  }

  /**
   * Process all registered type attachments and aggregate results
   * @returns Aggregated output from all plugins
   */
  async processAll(): Promise<AggregatedPluginOutput> {
    const aggregated: AggregatedPluginOutput = {
      types: new Map(),
      resolvers: new Map(),
      executors: new Map(),
    };

    if (this.typeAttachments.length === 0) {
      return aggregated;
    }

    logger.newline();
    logger.log(
      `Processing ${styles.highlight(this.typeAttachments.length.toString())} plugin attachments...`,
    );

    for (const attachment of this.typeAttachments) {
      const plugin = this.plugins.get(attachment.pluginId);
      if (!plugin) {
        logger.warn(
          `Plugin "${styles.warning(attachment.pluginId)}" not found for type "${styles.highlight(attachment.type.name)}"`,
        );
        continue;
      }

      // Validate config against schema if provided
      if (plugin.configSchema) {
        const validationErrors = validatePluginConfig(attachment.config, plugin.configSchema);
        if (validationErrors.length > 0) {
          logger.error(
            `Invalid config for plugin ${styles.error(plugin.id)} on type "${styles.highlight(attachment.type.name)}":`,
          );
          for (const error of validationErrors) {
            const fieldPrefix = error.field ? `${error.field}: ` : "";
            logger.error(`  ${fieldPrefix}${error.message}`);
          }
          throw new Error(
            `Plugin config validation failed for "${plugin.id}" on type "${attachment.type.name}"`,
          );
        }
      }

      try {
        const output = await plugin.process({
          type: attachment.type,
          config: attachment.config,
          namespace: attachment.namespace,
        });

        this.mergeOutput(aggregated, output, attachment.type.name, plugin.id);

        logger.log(
          `Plugin ${styles.info(plugin.id)} processed type ${styles.success(attachment.type.name)}`,
        );
      } catch (error) {
        logger.error(
          `Error processing plugin ${styles.error(plugin.id)} for type ${styles.highlight(attachment.type.name)}`,
        );
        logger.error(String(error));
        throw error;
      }
    }

    // Log summary
    const typeCount = aggregated.types.size;
    const resolverCount = aggregated.resolvers.size;
    const executorCount = aggregated.executors.size;

    if (typeCount > 0 || resolverCount > 0 || executorCount > 0) {
      logger.newline();
      logger.log("Plugin processing complete:");
      if (typeCount > 0) {
        logger.log(`  Types generated: ${styles.success(typeCount.toString())}`);
      }
      if (resolverCount > 0) {
        logger.log(`  Resolvers generated: ${styles.success(resolverCount.toString())}`);
      }
      if (executorCount > 0) {
        logger.log(`  Executors generated: ${styles.success(executorCount.toString())}`);
      }
    }

    return aggregated;
  }

  /**
   * Merge plugin output into the aggregated result
   * @param aggregated - The aggregated output to merge into
   * @param output - The plugin output to merge
   * @param sourceTypeName - Name of the source type being processed
   * @param pluginId - ID of the plugin that generated the output
   */
  private mergeOutput(
    aggregated: AggregatedPluginOutput,
    output: PluginOutput,
    sourceTypeName: string,
    pluginId: string,
  ): void {
    // Merge types
    for (const type of output.types ?? []) {
      const key = type.name;
      if (aggregated.types.has(key)) {
        logger.warn(
          `Duplicate type "${styles.warning(key)}" generated by plugin ${styles.info(pluginId)} for type "${styles.highlight(sourceTypeName)}"`,
        );
      }
      aggregated.types.set(key, type);
    }

    // Merge resolvers
    for (const resolver of output.resolvers ?? []) {
      const key = resolver.name;
      if (aggregated.resolvers.has(key)) {
        logger.warn(
          `Duplicate resolver "${styles.warning(key)}" generated by plugin ${styles.info(pluginId)} for type "${styles.highlight(sourceTypeName)}"`,
        );
      }
      aggregated.resolvers.set(key, resolver);
    }

    // Merge executors
    for (const executor of output.executors ?? []) {
      const key = executor.name;
      if (aggregated.executors.has(key)) {
        logger.warn(
          `Duplicate executor "${styles.warning(key)}" generated by plugin ${styles.info(pluginId)} for type "${styles.highlight(sourceTypeName)}"`,
        );
      }
      aggregated.executors.set(key, executor);
    }
  }

  /**
   * Check if there are any plugin attachments to process
   * @returns True if there are attachments to process
   */
  hasAttachments(): boolean {
    return this.typeAttachments.length > 0;
  }

  /**
   * Get the count of registered plugins
   * @returns Number of registered plugins
   */
  get pluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Get the count of registered type attachments
   * @returns Number of registered type attachments
   */
  get attachmentCount(): number {
    return this.typeAttachments.length;
  }
}
