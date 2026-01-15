import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { logger } from "../../utils/logger";
import { logErdBetaWarning } from "./beta";
import { DEFAULT_DIST_DIR } from "./constants";
import { prepareErdBuild } from "./prepare";
import { resolveCliBinPath } from "./resolve-cli-bin";

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
      description: "TailorDB namespace name (optional if only one namespace is defined in config)",
      alias: "n",
    },
    output: {
      type: "string",
      description: "Output file path for tbls-compatible ERD JSON",
      alias: "o",
      default: ".tailor-sdk/erd/schema.json",
    },
  },
  run: withCommonArgs(async (args) => {
    logErdBetaWarning();
    const outputPath = path.resolve(process.cwd(), String(args.output));
    const erdDir = path.dirname(path.resolve(process.cwd(), DEFAULT_DIST_DIR));

    await prepareErdBuild({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      namespace: args.namespace,
      outputPath,
      erdDir,
    });

    await runServeDist(erdDir);
  }),
});
