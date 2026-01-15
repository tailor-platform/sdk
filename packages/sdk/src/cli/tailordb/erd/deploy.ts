import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { loadConfig } from "@/cli/config-loader";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { deployStaticWebsite, logSkippedFiles } from "../../staticwebsite/deploy";
import { logger } from "../../utils/logger";
import { logErdBetaWarning } from "./beta";
import { exportTailorDBSchema } from "./export";
import { runLiamBuild } from "./liam";
import { resolveSingleNamespace } from "./namespace";
import type { TailorDBSchemaOptions } from "./export";

async function writeTblsSchema(
  options: TailorDBSchemaOptions & { outputPath: string },
): Promise<void> {
  const schema = await exportTailorDBSchema(options);
  const json = JSON.stringify(schema, null, 2);

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, json, "utf8");

  const relativePath = path.relative(process.cwd(), options.outputPath);
  logger.success(`Wrote ERD schema to ${relativePath}`);
}

export const erdDeployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy ERD static website for a TailorDB namespace (beta)",
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
    dist: {
      type: "string",
      description: "Path to ERD static site files (built by liam)",
      alias: "d",
      default: ".tailor-sdk/erd/dist",
    },
  },
  run: withCommonArgs(async (args) => {
    logErdBetaWarning();
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const namespace = args.namespace ?? (await resolveSingleNamespace(args.config));

    const { config } = await loadConfig(args.config);
    const dbConfig = config.db?.[namespace];

    if (!dbConfig || typeof dbConfig !== "object" || "external" in dbConfig) {
      throw new Error(`TailorDB namespace "${namespace}" not found in config.db.`);
    }

    const erdSiteName = dbConfig.erdSite;

    if (!erdSiteName) {
      throw new Error(
        `No erdSite configured for TailorDB namespace "${namespace}". ` +
          `Add erdSite: "<static-website-name>" to db.${namespace} in tailor.config.ts.`,
      );
    }

    const schemaOutputPath = path.resolve(process.cwd(), String(args.output));
    await writeTblsSchema({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      namespace,
      outputPath: schemaOutputPath,
    });

    const distDir = path.resolve(process.cwd(), String(args.dist));
    const erdDir = path.dirname(distDir);
    await runLiamBuild(schemaOutputPath, erdDir);

    if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
      throw new Error(`Directory not found or not a directory: ${distDir}`);
    }

    const { url, skippedFiles } = await deployStaticWebsite(
      client,
      workspaceId,
      erdSiteName,
      distDir,
      true,
    );

    logger.success(`ERD site "${erdSiteName}" deployed successfully. URL: ${url}`);
    logSkippedFiles(skippedFiles);
  }),
});
