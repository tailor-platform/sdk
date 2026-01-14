import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { logger } from "../../utils/logger";

/**
 * Run the liam CLI to build an ERD static site from a schema file.
 * @param {string} schemaPath - Path to the ERD schema JSON file
 * @param {string} cwd - Working directory where liam will run (dist is created here)
 * @returns {Promise<void>} Resolves when the build completes successfully
 */
export async function runLiamBuild(schemaPath: string, cwd: string): Promise<void> {
  fs.mkdirSync(cwd, { recursive: true });

  return await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["dlx", "@liam-hq/cli", "erd", "build", "--format", "tbls", "--input", schemaPath],
      {
        stdio: "inherit",
        cwd,
      },
    );

    child.on("error", (error) => {
      logger.error("Failed to run `pnpm dlx @liam-hq/cli ...`. Ensure pnpm is installed.");
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error(
          "liam CLI exited with a non-zero code. Ensure `pnpm dlx @liam-hq/cli erd build --format tbls --input schema.json` works in your project.",
        );
        reject(new Error(`liam CLI exited with code ${code ?? 1}`));
      }
    });
  });
}
