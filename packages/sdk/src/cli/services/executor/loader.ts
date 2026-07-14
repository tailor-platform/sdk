import { importUserFile } from "#/cli/shared/import-user-file";
import { ExecutorSchema } from "#/parser/service/executor/index";
import type { Executor } from "#/types/executor.generated";

/**
 * Load and validate an executor definition from a file.
 * @param executorFilePath - Path to the executor file
 * @param baseDir - Directory the executor's tsconfig is resolved against
 * @returns Parsed executor or null if invalid
 */
export async function loadExecutor(
  executorFilePath: string,
  baseDir: string,
): Promise<Executor | null> {
  const executorModule = await importUserFile(executorFilePath, baseDir);
  const executor = executorModule.default;

  const parseResult = ExecutorSchema.safeParse(executor);
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
