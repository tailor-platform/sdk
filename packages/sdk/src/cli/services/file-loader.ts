import { logger } from "#/cli/shared/logger";
import {
  loadFilesWithBaseDir as loadFilesFrom,
  loadFilesWithIgnores as loadFiles,
  type FileLoadConfig,
  type LoadedFiles,
} from "#/utils/file-loader";

export type { FileLoadConfig } from "#/utils/file-loader";

/**
 * Load files using the configured patterns and report warnings through the CLI logger.
 * @param config - Configuration with files patterns and optional ignores patterns
 * @param baseDir - Directory relative patterns are resolved against
 * @returns Array of absolute file paths
 */
export function loadFilesWithIgnores(config: FileLoadConfig, baseDir: string): string[] {
  return loadFiles(config, baseDir, logger.warn);
}

/**
 * Load files like `loadFilesWithIgnores`, also returning the directory the patterns were resolved against.
 * @param config - Configuration with files patterns and optional ignores patterns
 * @param baseDir - Directory relative patterns are resolved against
 * @returns The absolute file paths and the directory their patterns were resolved against
 */
export function loadFilesWithBaseDir(config: FileLoadConfig, baseDir: string): LoadedFiles {
  return loadFilesFrom(config, baseDir, logger.warn);
}
