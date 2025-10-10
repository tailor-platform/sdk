import { pathToFileURL } from "node:url";
import { type Executor } from "../types";
import { isExecutor } from "../utils";
import { type ILoader } from "@/cli/bundler";

export class ExecutorLoader implements ILoader<Executor> {
  async load(executorFilePath: string): Promise<Executor | null> {
    const executorModule = await import(
      `${pathToFileURL(executorFilePath).href}?t=${Date.now()}`
    );
    const executor = executorModule.default;
    if (!isExecutor(executor)) {
      return null;
    }

    return executor;
  }
}
