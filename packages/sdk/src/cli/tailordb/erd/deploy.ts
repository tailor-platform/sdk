import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../../args";
import { deployStaticWebsite, logSkippedFiles } from "../../staticwebsite/deploy";
import { logger } from "../../utils/logger";
import { prepareErdBuilds } from "./export";
import { initErdContext } from "./utils";

export const erdDeployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy ERD static website for TailorDB namespace(s) (beta)",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
    ...jsonArgs,
    namespace: {
      type: "string",
      description:
        "TailorDB namespace name (optional - deploys all namespaces with erdSite if omitted)",
      alias: "n",
    },
  },
  run: withCommonArgs(async (args) => {
    const { client, workspaceId, config } = await initErdContext(args);
    const buildResults = await prepareErdBuilds({
      client,
      workspaceId,
      config,
      namespace: args.namespace,
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

    if (args.json) {
      logger.out(deployResults);
    } else {
      for (const result of deployResults) {
        logger.success(`ERD site "${result.erdSite}" deployed successfully.`);
        logger.out(result.url);
        logSkippedFiles(result.skippedFiles);
      }
    }
  }),
});
