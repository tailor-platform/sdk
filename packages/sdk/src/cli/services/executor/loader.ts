import { pathToFileURL } from "node:url";
import { ExecutorSchema } from "@/parser/service/executor";
import type { Executor } from "@/types/executor.generated";

export function stripExecutorTriggerArgs(executor: unknown): unknown {
  if (executor === null || typeof executor !== "object") {
    return executor;
  }

  const trigger = (executor as { trigger?: unknown }).trigger;
  if (trigger === null || typeof trigger !== "object" || !("__args" in trigger)) {
    return executor;
  }

  const { __args: _args, ...triggerConfig } = trigger as Record<string, unknown>;
  return { ...(executor as Record<string, unknown>), trigger: triggerConfig };
}

/**
 * Load and validate an executor definition from a file.
 * @param executorFilePath - Path to the executor file
 * @returns Parsed executor or null if invalid
 */
export async function loadExecutor(executorFilePath: string): Promise<Executor | null> {
  const executorModule = await import(pathToFileURL(executorFilePath).href);
  const executor = executorModule.default;

  const parseResult = ExecutorSchema.safeParse(stripExecutorTriggerArgs(executor));
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
