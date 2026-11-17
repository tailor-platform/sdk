import { logger } from "#/cli/shared/logger";
import { loadFilesWithIgnores as loadFiles, type FileLoadConfig } from "#/utils/file-loader";

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
