import { pathToFileURL } from "node:url";
import { type Executor } from "../types";
import { isExecutor } from "../utils";
import { type ILoader } from "@/bundler";

export class ExecutorLoader implements ILoader<Executor> {
  async load(executorFilePath: string): Promise<Executor | null> {
    const executorModule = await import(
      `${pathToFileURL(executorFilePath).toString()}?t=${new Date().getTime()}`
    );
    const executor = executorModule.default;
    if (!isExecutor(executor)) {
      return null;
    }

    return executor;
  }
}
