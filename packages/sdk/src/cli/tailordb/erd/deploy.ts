import * as fs from "node:fs";
import * as path from "node:path";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { deployStaticWebsite, logSkippedFiles } from "../../staticwebsite/deploy";
import { logger } from "../../utils/logger";
import { DEFAULT_DIST_DIR, DEFAULT_ERD_BASE_DIR, DEFAULT_SCHEMA_OUTPUT } from "./constants";
import { resolveAllErdSites, resolveDbConfig } from "./db-config";
import { prepareErdBuild } from "./prepare";
import { initErdContext } from "./utils";
import type { OperatorClient } from "../../client";

interface DeployTarget {
  namespace: string;
  erdSite: string;
  schemaOutputPath: string;
  distDir: string;
  erdDir: string;
}

async function deployErdForNamespace(
  target: DeployTarget,
  options: {
    client: OperatorClient;
    workspaceId: string;
  },
): Promise<void> {
  const { namespace, erdSite, schemaOutputPath, distDir, erdDir } = target;
  const { client, workspaceId } = options;

  logger.info(`Deploying ERD for namespace "${namespace}" to site "${erdSite}"...`);

  await prepareErdBuild({
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
    erdSite,
    distDir,
    true,
  );

  logger.success(`ERD site "${erdSite}" deployed successfully. URL: ${url}`);
  logSkippedFiles(skippedFiles);
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
    const { client, workspaceId, config } = await initErdContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
      config: args.config,
    });

    let targets: DeployTarget[];

    if (args.namespace) {
      const { namespace, erdSite } = resolveDbConfig(config, args.namespace);
      if (!erdSite) {
        throw new Error(
          `No erdSite configured for TailorDB namespace "${namespace}". ` +
            `Add erdSite: "<static-website-name>" to db.${namespace} in tailor.config.ts.`,
        );
      }
      const schemaOutputPath = path.resolve(process.cwd(), String(args.output));
      const distDir = path.resolve(process.cwd(), String(args.dist));
      const erdDir = path.dirname(distDir);
      targets = [{ namespace, erdSite, schemaOutputPath, distDir, erdDir }];
    } else {
      const erdSites = resolveAllErdSites(config);
      if (erdSites.length === 0) {
        throw new Error(
          "No namespaces with erdSite configured found. " +
            'Add erdSite: "<static-website-name>" to db.<namespace> in tailor.config.ts.',
        );
      }
      logger.info(`Found ${erdSites.length} namespace(s) with erdSite configured.`);

      const baseDir = path.resolve(process.cwd(), DEFAULT_ERD_BASE_DIR);
      targets = erdSites.map(({ namespace, erdSite }) => {
        const erdDir = path.join(baseDir, namespace);
        return {
          namespace,
          erdSite,
          schemaOutputPath: path.join(erdDir, "schema.json"),
          distDir: path.join(erdDir, "dist"),
          erdDir,
        };
      });
    }

    await Promise.all(
      targets.map((target) =>
        deployErdForNamespace(target, {
          client,
          workspaceId,
        }),
      ),
    );
  }),
});
