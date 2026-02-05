import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger, styles } from "@/cli/utils/logger";
import {
  ExecutorSchema,
  type Executor,
  type ExecutorServiceConfig,
} from "@/parser/service/executor";
import type { PluginManager, PluginExecutorInfo } from "@/plugin/manager";

/**
 * Information about a plugin-generated executor converted to Executor format
 */
export interface PluginExecutor {
  /** The executor in standard Executor format */
  executor: Executor;
  /** Plugin ID that generated this executor */
  pluginId: string;
  /** Source type name (for type-attached executors) */
  sourceTypeName?: string;
}

export type ExecutorService = {
  readonly config: ExecutorServiceConfig;
  getExecutors: () => Record<string, Executor>;
  getPluginExecutors: () => ReadonlyArray<PluginExecutor>;
  loadExecutors: () => Promise<Record<string, Executor> | undefined>;
  loadPluginExecutors: () => void;
};

/**
 * Convert a PluginGeneratedExecutor to standard Executor format
 * @param info - Plugin executor info
 * @returns Executor in standard format, or undefined if conversion fails
 */
function convertPluginExecutor(info: PluginExecutorInfo): Executor | undefined {
  const { executor } = info;

  // Convert trigger
  let trigger: Executor["trigger"];
  switch (executor.trigger.kind) {
    case "recordCreated":
    case "recordUpdated":
    case "recordDeleted":
      trigger = {
        kind: executor.trigger.kind,
        typeName: executor.trigger.typeName,
      };
      break;
    case "schedule":
      trigger = {
        kind: "schedule",
        cron: executor.trigger.cron,
        timezone: executor.trigger.timezone ?? "UTC",
      };
      break;
    case "incomingWebhook":
      trigger = {
        kind: "incomingWebhook",
      };
      break;
    default:
      logger.warn(`Unknown trigger kind in plugin-generated executor: ${executor.name}`);
      return undefined;
  }

  // Convert operation
  let operation: Executor["operation"];
  const op = executor.operation;
  switch (op.kind) {
    case "function":
      // For plugin-generated executors, body is a string code
      // We need to convert it to a function for the Executor format
      // This will be handled specially during bundling
      operation = {
        kind: "function",
        // Store the code string as a special marker for bundling
        // The bundler will recognize this and handle it appropriately
        body: new Function(`return ${op.body}`)() as () => unknown,
      };
      break;
    case "graphql":
      operation = {
        kind: "graphql",
        query: op.query,
        appName: op.appName,
        variables: op.variables
          ? (new Function(`return ${op.variables}`)() as (args: unknown) => Record<string, unknown>)
          : undefined,
      };
      break;
    case "webhook":
      operation = {
        kind: "webhook",
        url: () => op.url,
      };
      break;
    case "workflow":
      operation = {
        kind: "workflow",
        workflowName: op.workflowName,
      };
      break;
    default:
      logger.warn(`Unknown operation kind in plugin-generated executor: ${executor.name}`);
      return undefined;
  }

  return {
    name: executor.name,
    description: executor.description,
    disabled: false,
    trigger,
    operation,
  };
}

/**
 * Parameters for creating an ExecutorService
 */
export interface CreateExecutorServiceParams {
  /** The executor service configuration */
  config: ExecutorServiceConfig;
  /** Plugin manager for processing plugin-generated executors */
  pluginManager?: PluginManager;
}

/**
 * Creates a new ExecutorService instance.
 * @param params - Parameters for creating the service
 * @returns A new ExecutorService instance
 */
export function createExecutorService(params: CreateExecutorServiceParams): ExecutorService {
  const { config, pluginManager } = params;
  const executors: Record<string, Executor> = {};
  const pluginExecutors: PluginExecutor[] = [];

  const loadExecutorForFile = async (executorFile: string): Promise<Executor | undefined> => {
    try {
      const executorModule = await import(pathToFileURL(executorFile).href);
      const result = ExecutorSchema.safeParse(executorModule.default);
      if (result.success) {
        const relativePath = path.relative(process.cwd(), executorFile);
        logger.log(
          `Executor: ${styles.successBright(`"${result.data.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
        executors[executorFile] = result.data;
        return result.data;
      }
    } catch (error) {
      const relativePath = path.relative(process.cwd(), executorFile);
      logger.error(`Failed to load executor from ${styles.bold(relativePath)}`);
      logger.error(String(error));
      throw error;
    }
    return undefined;
  };

  return {
    config,
    getExecutors: () => executors,
    getPluginExecutors: () => pluginExecutors,
    loadExecutors: async () => {
      if (Object.keys(executors).length > 0) {
        return executors;
      }
      if (!config.files || config.files.length === 0) {
        return;
      }

      const executorFiles = loadFilesWithIgnores(config);

      logger.newline();
      logger.log(`Found ${styles.highlight(executorFiles.length.toString())} executor files`);

      await Promise.all(executorFiles.map((executorFile) => loadExecutorForFile(executorFile)));
      return executors;
    },
    loadPluginExecutors: () => {
      if (!pluginManager) return;

      const infos = pluginManager.getPluginGeneratedExecutors();
      if (infos.length === 0) return;

      // Ensure the executors output directory exists
      const outputDir = path.resolve(getDistDir(), "executors");
      fs.mkdirSync(outputDir, { recursive: true });

      for (const info of infos) {
        const converted = convertPluginExecutor(info);
        if (converted) {
          // Use a unique key for plugin-generated executors
          const key = `plugin:${info.pluginId}:${converted.name}`;
          executors[key] = converted;

          // For function operations, write the body code to a file
          // so the apply process can read it
          const op = info.executor.operation;
          if (op.kind === "function") {
            const scriptPath = path.join(outputDir, `${converted.name}.js`);
            // The body is a function expression like "(args) => { ... }"
            // Wrap it as an ESM export to match the bundler output format
            const scriptContent = `export const main = ${op.body};\n`;
            fs.writeFileSync(scriptPath, scriptContent);
          }

          pluginExecutors.push({
            executor: converted,
            pluginId: info.pluginId,
            sourceTypeName: info.sourceTypeName,
          });
          logger.log(
            `  Plugin Executor: ${styles.successBright(`"${converted.name}"`)} from plugin ${styles.info(info.pluginId)}`,
          );
        }
      }
    },
  };
}
