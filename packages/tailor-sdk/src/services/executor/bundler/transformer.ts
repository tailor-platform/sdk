import * as fs from "node:fs";
import * as path from "node:path";
import ml from "multiline-ts";
import { type Executor } from "../types";
import { type ITransformer } from "@/bundler";
import { trimSDKCode } from "@/bundler/utils";
import { DB_WRAPPER_DEFINITION, wrapDbFn } from "@/bundler/wrapper";

export class ExecutorTransformer implements ITransformer<Executor> {
  constructor() {}

  transform(filePath: string, executor: Executor, tempDir: string): string[] {
    const trimmedContent = trimSDKCode(filePath);
    const transformedPath = path.join(
      path.dirname(filePath),
      path.basename(filePath, ".js") + ".transformed.js",
    );

    // Check if this is a function executor
    if (!["function", "job_function"].includes(executor.exec.manifest.Kind)) {
      // For non-function executors (webhook, gql), return empty array
      return [];
    }

    // Extract the function reference and namespace from the context
    const execContext = executor.exec.context as unknown as {
      fn: (...args: unknown[]) => unknown;
      dbNamespace?: string;
    };
    const functionRef = execContext.fn;
    const dbNamespace = execContext.dbNamespace;
    if (!functionRef) {
      throw new Error(
        `Function reference not found in executor ${executor.name}`,
      );
    }

    // Write the transformed file with the executor function
    fs.writeFileSync(
      transformedPath,
      ml /* js */ `
      ${trimmedContent}

      // Export the executor function
      export const __executor_function = ${functionRef.toString()};
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
    const executorContent = ml /* js */ `
      import { __executor_function } from "${relativePath}";

      ${DB_WRAPPER_DEFINITION}
      globalThis.main = ${wrapDbFn(dbNamespace ?? "", "__executor_function")};
    `;

    fs.writeFileSync(executorFilePath, executorContent);
    return [executorFilePath];
  }
}
