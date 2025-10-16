import * as fs from "node:fs";
import * as path from "node:path";
import ml from "multiline-ts";
import { type Executor } from "@/configure/services/executor/types";
import { type ITransformer } from "@/cli/bundler";
import { DB_WRAPPER_DEFINITION, wrapDbFn } from "@/cli/bundler/wrapper";
import { pathToFileURL } from "node:url";

export class ExecutorTransformer implements ITransformer {
  constructor() {}

  async transform(filePath: string, tempDir: string): Promise<string[]> {
    const sourceText = fs.readFileSync(filePath).toString();
    const transformedPath = path.join(
      path.dirname(filePath),
      path.basename(filePath, ".js") + ".transformed.js",
    );

    const executor = (
      await import(`${pathToFileURL(filePath)}?t=${new Date().getTime()}`)
    ).default as Executor;
    // Check if this is a function executor
    const exec = executor.exec;
    if (exec.Kind !== "function" && exec.Kind !== "job_function") {
      // For non-function executors (webhook, gql), return empty array
      return [];
    }
    if (!exec.fn) {
      throw new Error(
        `Function reference not found in executor ${executor.name}`,
      );
    }

    // Write the transformed file with the executor function
    fs.writeFileSync(
      transformedPath,
      ml /* js */ `
      ${sourceText}

      // Export the executor function
      export const __executor_function = ${exec.fn.toString()};
      `,
    );

    // Create a temporary directory for executor steps
    const stepsDir = path.join(tempDir, "executor_steps");
    fs.mkdirSync(stepsDir, { recursive: true });

    // Create the final executor file that will be bundled
    const executorFilePath = path.join(stepsDir, `${executor.name}.js`);
    const relativePath = path
      .relative(stepsDir, transformedPath)
      .replace(/\\/g, "/");
    const executorContent = exec.dbNamespace
      ? ml /* js */ `
      import { __executor_function } from "${relativePath}";

      ${DB_WRAPPER_DEFINITION}
      globalThis.main = ${wrapDbFn(exec.dbNamespace, "__executor_function")};
    `
      : ml /* js */ `
      import { __executor_function } from "${relativePath}";

      globalThis.main = __executor_function;
    `;

    fs.writeFileSync(executorFilePath, executorContent);
    return [executorFilePath];
  }
}
