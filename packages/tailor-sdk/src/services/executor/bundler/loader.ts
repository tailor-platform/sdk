import { pathToFileURL } from "node:url";
import { Executor } from "../types";
import { isExecutor } from "../utils";
import { ILoader } from "@/bundler";

export class ExecutorLoader implements ILoader<Executor> {
  async load(executorFilePath: string): Promise<Executor> {
    const executorModule = await import(
      pathToFileURL(executorFilePath).toString()
    );
    const executor = executorModule.default;
    if (!isExecutor(executor)) {
      throw new Error(
        `The provided module does not export an Executor instance. path: ${executorFilePath}`,
      );
    }

    return executor;
  }
}
