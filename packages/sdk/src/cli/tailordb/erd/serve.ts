import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../../args";
import { logger } from "../../utils/logger";
import { exportTailorDBSchema } from "./export";
import type { TailorDBSchemaOptions } from "./export";

async function writeTblsSchemaAndReturnPath(
  options: TailorDBSchemaOptions & { output?: string; printJson?: boolean },
): Promise<string> {
  const outputPath = path.resolve(process.cwd(), options.output ?? "schema.json");
  const schema = await exportTailorDBSchema(options);
  const json = JSON.stringify(schema, null, 2);

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, json, "utf8");

  const relativePath = path.relative(process.cwd(), outputPath);
  logger.success(`Wrote ERD schema to ${relativePath}`);

  if (options.printJson) {
    logger.out(schema);
  }

  return outputPath;
}

async function runLiamCli(schemaPath: string): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["dlx", "@liam-hq/cli", "erd", "build", "--format", "tbls", "--input", schemaPath],
      {
        stdio: "inherit",
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

async function runServeDist(): Promise<void> {
  return await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["dlx", "serve", "dist"], {
      stdio: "inherit",
    });

    child.on("error", (error) => {
      logger.error("Failed to run `pnpm dlx serve dist`. Ensure pnpm is installed.");
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error(
          "serve CLI exited with a non-zero code. Ensure `pnpm dlx serve dist` works in your project.",
        );
        reject(new Error(`serve CLI exited with code ${code ?? 1}`));
      }
    });
  });
}

export const erdServeCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Generate and serve ERD (liam build + `pnpm dlx serve dist`)",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
    ...jsonArgs,
    namespace: {
      type: "string",
      description: "TailorDB namespace name (optional if only one namespace is defined in config)",
      alias: "n",
    },
    output: {
      type: "string",
      description: "Output file path for tbls-compatible ERD JSON",
      alias: "o",
      default: "schema.json",
    },
  },
  run: withCommonArgs(async (args) => {
    const schemaPath = await writeTblsSchemaAndReturnPath({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      namespace: args.namespace,
      output: args.output,
      printJson: Boolean(args.json),
    });

    await runLiamCli(schemaPath);
    await runServeDist();
  }),
});
