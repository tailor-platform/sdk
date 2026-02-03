import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import type { FunctionRegistryServiceConfig } from "@/parser/service/function-registry/types";

export interface LoadedFunction {
  name: string;
  filePath: string;
}

export type FunctionRegistryService = {
  readonly config: FunctionRegistryServiceConfig;
  getFunctions: () => ReadonlyArray<LoadedFunction>;
  loadFunctions: () => Promise<ReadonlyArray<LoadedFunction> | undefined>;
};

/**
 * Creates a new FunctionRegistryService instance.
 * @param config - The function registry service configuration
 * @returns A new FunctionRegistryService instance
 */
export function createFunctionRegistryService(
  config: FunctionRegistryServiceConfig,
): FunctionRegistryService {
  const functions: LoadedFunction[] = [];

  return {
    config,
    getFunctions: () => functions,
    loadFunctions: async () => {
      if (functions.length > 0) {
        return functions;
      }
      if (!config.files || config.files.length === 0) {
        return;
      }

      const files = loadFilesWithIgnores(config);

      logger.newline();
      logger.log(`Found ${styles.highlight(files.length.toString())} function registry files`);

      for (const file of files) {
        // Use filename (without extension) as function name
        const baseName = path.basename(file, path.extname(file));
        const relativePath = path.relative(process.cwd(), file);
        logger.log(
          `Function: ${styles.successBright(`"${baseName}"`)} loaded from ${styles.path(relativePath)}`,
        );
        functions.push({ name: baseName, filePath: file });
      }

      return functions;
    },
  };
}
