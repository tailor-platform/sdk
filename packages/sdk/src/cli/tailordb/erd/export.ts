import * as path from "node:path";
import { defineCommand } from "citty";
import { commonArgs, deploymentArgs, withCommonArgs } from "../../args";
import { logger } from "../../utils/logger";
import { DEFAULT_SCHEMA_OUTPUT } from "./constants";
import { prepareErdBuilds } from "./liam";
import { initErdContext } from "./utils";

export const erdExportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Export Liam ERD dist from applied TailorDB schema (beta)",
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
  },
  run: withCommonArgs(async (args) => {
    const { client, workspaceId, config } = await initErdContext(args);
    const outputDir = path.dirname(path.resolve(process.cwd(), String(args.output)));

    const results = await prepareErdBuilds({
      client,
      workspaceId,
      config,
      namespace: args.namespace,
      outputDir,
    });

    for (const result of results) {
      logger.success(`Exported ERD for namespace "${result.namespace}"`);
      logger.success(`  - Liam ERD dist: ${result.distDir}`);
      logger.info(`  - tbls schema.json: ${result.schemaOutputPath}`);
    }
  }),
});
