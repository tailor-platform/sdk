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
import { DEFAULT_DIST_DIR, DEFAULT_SCHEMA_OUTPUT } from "./constants";
import { resolveDbConfig } from "./namespace";
import { prepareErdBuild } from "./prepare";

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
      default: DEFAULT_SCHEMA_OUTPUT,
    },
    dist: {
      type: "string",
      description: "Path to ERD static site files (built by liam)",
      alias: "d",
      default: DEFAULT_DIST_DIR,
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

    const schemaOutputPath = path.resolve(process.cwd(), String(args.output));
    const distDir = path.resolve(process.cwd(), String(args.dist));
    const erdDir = path.dirname(distDir);

    const { config } = await loadConfig(args.config);
    const { namespace, dbConfig } = resolveDbConfig(config, args.namespace);

    const erdSiteName = dbConfig.erdSite;

    if (!erdSiteName) {
      throw new Error(
        `No erdSite configured for TailorDB namespace "${namespace}". ` +
          `Add erdSite: "<static-website-name>" to db.${namespace} in tailor.config.ts.`,
      );
    }

    await prepareErdBuild({
      configPath: args.config,
      namespace,
      client,
      workspaceId,
      outputPath: schemaOutputPath,
      erdDir,
    });

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
