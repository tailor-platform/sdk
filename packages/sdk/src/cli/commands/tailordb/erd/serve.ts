import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { logger } from "@/cli/shared/logger";
import { resolveCliBinPath } from "@/cli/shared/resolve-cli-bin";
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
        packageName: "serve",
        binName: "serve",
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
      logger.error("Failed to run `serve dist`.");
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

export const erdServeCommand = defineAppCommand({
  name: "serve",
  description: "Generate and serve ERD locally (liam build + serve dist). (beta)",
  args: z
    .object({
      ...deploymentArgs,
      namespace: arg(z.string().optional(), {
        alias: "n",
        description: "TailorDB namespace name (uses first namespace in config if not specified)",
      }),
    })
    .strict(),
  run: async (args) => {
    const { client, workspaceId, config } = await initErdContext(args);

    const results = await prepareErdBuilds({
      client,
      workspaceId,
      config,
      namespace: args.namespace,
    });

    await runServeDist(results);
  },
});
