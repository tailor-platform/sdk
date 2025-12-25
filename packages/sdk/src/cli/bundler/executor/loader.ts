import { pathToFileURL } from "node:url";
import { ExecutorSchema, type Executor } from "@/parser/service/executor";

export async function loadExecutor(executorFilePath: string): Promise<Executor | null> {
  const executorModule = await import(pathToFileURL(executorFilePath).href);
  const executor = executorModule.default;

  const parseResult = ExecutorSchema.safeParse(executor);
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
