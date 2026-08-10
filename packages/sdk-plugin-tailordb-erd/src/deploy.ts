import { assertWritable, deployStaticWebsite } from "@tailor-platform/sdk/cli";
import { deploymentArgs } from "@tailor-platform/shared/args";
import { defineAppCommand } from "@tailor-platform/shared/command";
import { logger } from "@tailor-platform/shared/logger";
import { arg } from "politty";
import { z } from "zod";
import { prepareErdBuilds } from "./export";
import { initErdDeployContext } from "./utils";

function logSkippedFiles(skippedFiles: string[]): void {
  if (skippedFiles.length === 0) {
    return;
  }
  logger.warn(
    "Deployment completed, but some files failed to upload. These files may have unsupported content types or other validation issues. Please review the list below:",
  );
  for (const file of skippedFiles) {
    logger.log(`  - ${file}`);
  }
}

export const erdDeployCommand = defineAppCommand({
  name: "deploy",
  description: "Deploy ERD static website for TailorDB namespace(s).",
  args: z.strictObject({
    ...deploymentArgs,
    namespace: arg(z.string().optional(), {
      alias: "n",
      description:
        "TailorDB namespace name (optional - deploys all namespaces with an ERD site configured if omitted)",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { client, workspaceId } = await initErdDeployContext(args);
    const buildResults = await prepareErdBuilds({
      configPath: args.config,
      namespace: args.namespace,
      requireErdSite: true,
    });

    const deployResults = await Promise.all(
      buildResults.map(async (result) => {
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
