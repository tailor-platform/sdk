import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { logger } from "../../utils/logger";
import { resolveCliBinPath } from "../../utils/resolve-cli-bin";
import { prepareErdBuilds, type ErdBuildResult } from "./export";
import { initErdContext } from "./utils";

function formatServeCommand(namespace: string): string {
  return `tailor-sdk tailordb erd serve --namespace ${namespace}`;
}

async function runServeDist(results: ErdBuildResult[]): Promise<void> {
  if (results.length === 0) {
    throw new Error("No ERD build results found.");
  }

  const [primary, ...rest] = results;

  logger.info(`Serving ERD for namespace "${primary.namespace}".`);
  if (rest.length > 0) {
    const commands = rest.map((result) => `  - ${formatServeCommand(result.namespace)}`).join("\n");
    logger.warn(`Multiple namespaces found. To serve another namespace, run:\n${commands}`);
  }

  fs.mkdirSync(primary.erdDir, { recursive: true });

  return await new Promise<void>((resolve, reject) => {
    let serveBinPath: string;
    try {
      serveBinPath = resolveCliBinPath({
        cwd: primary.erdDir,
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
      cwd: primary.erdDir,
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

    const results = await prepareErdBuilds({
      client,
      workspaceId,
      config,
      namespace: args.namespace,
    });

    await runServeDist(results);
  }),
});
