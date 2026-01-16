import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { logger } from "../../utils/logger";
import { DEFAULT_ERD_BASE_DIR } from "./constants";
import { resolveDbConfig } from "./db-config";
import { prepareErdBuild } from "./liam";
import { resolveCliBinPath } from "./resolve-cli-bin";
import { initErdContext } from "./utils";

async function runServeDist(erdDir: string): Promise<void> {
  fs.mkdirSync(erdDir, { recursive: true });

  return await new Promise<void>((resolve, reject) => {
    let serveBinPath: string;
    try {
      serveBinPath = resolveCliBinPath({
        cwd: erdDir,
        packageName: "serve",
        binName: "serve",
        installHint: "npm i -D serve",
      });
    } catch (error) {
      logger.error(String(error));
      reject(error);
      return;
    }

    const child = spawn(process.execPath, [serveBinPath, "dist"], {
      stdio: "inherit",
      cwd: erdDir,
    });

    child.on("error", (error) => {
      logger.error("Failed to run `serve dist`. Ensure `serve` is installed in your project.");
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error(
          "serve CLI exited with a non-zero code. Ensure `serve dist` works in your project.",
        );
        reject(new Error(`serve CLI exited with code ${code ?? 1}`));
      }
    });
  });
}

export const erdServeCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Generate and serve ERD (liam build + `serve dist`) (beta)",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
    namespace: {
      type: "string",
      description: "TailorDB namespace name (uses first namespace in config if not specified)",
      alias: "n",
    },
  },
  run: withCommonArgs(async (args) => {
    const { client, workspaceId, config } = await initErdContext(args);
    const { namespace } = resolveDbConfig(config, args.namespace);
    const erdDir = path.resolve(process.cwd(), DEFAULT_ERD_BASE_DIR, namespace);
    const schemaOutputPath = path.join(erdDir, "schema.json");

    await prepareErdBuild({
      client,
      workspaceId,
      namespace,
      outputPath: schemaOutputPath,
      erdDir,
    });

    await runServeDist(erdDir);
  }),
});
