import { Executor } from "../types";
import { measure } from "@/performance";
import { isExecutor } from "../utils";
import { ILoader } from "@/bundler";

export class ExecutorLoader implements ILoader<Executor> {
  @measure
  async load(executorFilePath: string): Promise<Executor> {
    const executorModule = await import(executorFilePath);
    const executor = executorModule.default;
    if (!isExecutor(executor)) {
      throw new Error(
        `The provided module does not export an Executor instance. path: ${executorFilePath}`,
      );
    }

    return executor;
  }
}
