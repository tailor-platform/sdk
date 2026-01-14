import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { loadConfig } from "@/cli/config-loader";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { deployStaticWebsite, logSkippedFiles } from "../../staticwebsite/deploy";
import { logger } from "../../utils/logger";
import { exportTailorDBSchema } from "./export";
import type { TailorDBSchemaOptions } from "./export";

async function resolveNamespace(configPath?: string, explicitNamespace?: string): Promise<string> {
  if (explicitNamespace) {
    return explicitNamespace;
  }

  const { config } = await loadConfig(configPath);
  const namespaces = new Set<string>();

  if (config.db) {
    for (const [namespaceName] of Object.entries(config.db)) {
      namespaces.add(namespaceName);
    }
  }

  if (namespaces.size === 0) {
    throw new Error(
      "No TailorDB namespaces found in config. Please define db services in tailor.config.ts or pass --namespace.",
    );
  }

  if (namespaces.size > 1) {
    throw new Error(
      `Multiple TailorDB namespaces found in config: ${Array.from(namespaces).join(
        ", ",
      )}. Please specify one using --namespace.`,
    );
  }

  return Array.from(namespaces)[0]!;
}

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
    description: "Deploy ERD static website for a TailorDB namespace",
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
    const accessToken = await loadAccessToken({
      useProfile: true,
      profile: args.profile,
    });
    const client = await initOperatorClient(accessToken);
    const workspaceId = loadWorkspaceId({
      workspaceId: args["workspace-id"],
      profile: args.profile,
    });

    const namespace = await resolveNamespace(args.config, args.namespace);

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
