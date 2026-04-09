import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { logger } from "@/cli/shared/logger";
import { deployStaticWebsite, logSkippedFiles } from "../../staticwebsite/deploy";
import { prepareErdBuilds } from "./export";
import { initErdContext } from "./utils";

export const erdDeployCommand = defineAppCommand({
  name: "deploy",
  description: "Deploy ERD static website for TailorDB namespace(s).",
  args: z
    .object({
      ...deploymentArgs,
      namespace: arg(z.string().optional(), {
        alias: "n",
        description:
          "TailorDB namespace name (optional - deploys all namespaces with erdSite if omitted)",
      }),
    })
    .strict(),
  run: async (args) => {
    const { client, workspaceId, config } = await initErdContext(args);
    const buildResults = await prepareErdBuilds({
      client,
      workspaceId,
      config,
      namespace: args.namespace,
      requireErdSite: true,
    });

    const deployResults = await Promise.all(
      buildResults.map(async (result) => {
        if (!result.erdSite) {
          throw new Error(
            `No erdSite configured for namespace "${result.namespace}". ` +
              `Add erdSite: "<static-website-name>" to db.${result.namespace} in tailor.config.ts.`,
          );
        }

        if (!args.json) {
          logger.info(
            `Deploying ERD for namespace "${result.namespace}" to site "${result.erdSite}"...`,
          );
        }

        const { url, skippedFiles } = await deployStaticWebsite(
          client,
          workspaceId,
          result.erdSite,
          result.distDir,
          !args.json,
        );

        return {
          namespace: result.namespace,
          erdSite: result.erdSite,
          url,
          skippedFiles,
        };
      }),
    );
    logger.newline();

    if (args.json) {
      logger.out(deployResults);
    } else {
      for (const result of deployResults) {
        logSkippedFiles(result.skippedFiles);
        logger.newline();
        logger.success(`ERD site "${result.erdSite}" deployed successfully.`);
        logger.out(result.url);
      }
    }
  },
});
