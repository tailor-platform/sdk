import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { deployStaticWebsite, logSkippedFiles } from "../../staticwebsite/deploy";
import { logger } from "../../utils/logger";
import { prepareErdBuilds } from "./liam";
import { initErdContext } from "./utils";

export const erdDeployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Deploy ERD static website for TailorDB namespace(s) (beta)",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
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

    await Promise.all(
      buildResults.map(async (result) => {
        if (!result.erdSite) {
          throw new Error(
            `No erdSite configured for namespace "${result.namespace}". ` +
              `Add erdSite: "<static-website-name>" to db.${result.namespace} in tailor.config.ts.`,
          );
        }

        logger.info(
          `Deploying ERD for namespace "${result.namespace}" to site "${result.erdSite}"...`,
        );

        const { url, skippedFiles } = await deployStaticWebsite(
          client,
          workspaceId,
          result.erdSite,
          result.distDir,
          true,
        );

        logger.success(`ERD site "${result.erdSite}" deployed successfully. URL: ${url}`);
        logSkippedFiles(skippedFiles);
      }),
    );
  }),
});
