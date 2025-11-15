import { pathToFileURL } from "node:url";
import { type ILoader } from "@/cli/bundler";
import { ExecutorSchema, type Executor } from "@/parser/service/executor";

export class ExecutorLoader implements ILoader<Executor> {
  async load(executorFilePath: string): Promise<Executor | null> {
    const executorModule = await import(
      `${pathToFileURL(executorFilePath).href}?t=${Date.now()}`
    );
    const executor = executorModule.default;

    const parseResult = ExecutorSchema.safeParse(executor);
    if (!parseResult.success) {
      return null;
    }

    return parseResult.data;
  }
}
