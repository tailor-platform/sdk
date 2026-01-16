import * as path from "node:path";
import { logger } from "../../utils/logger";
import { DEFAULT_ERD_BASE_DIR } from "./constants";
import { resolveAllErdSites, resolveDbConfig } from "./db-config";
import { writeTblsSchemaToFile } from "./export";
import { runLiamBuild } from "./liam";
import type { TailorDBSchemaOptions } from "./export";
import type { OperatorClient } from "../../client";
import type { AppConfig } from "@/configure/config";

/**
 * Export TailorDB schema and build ERD artifacts via liam.
 * @param {TailorDBSchemaOptions & { outputPath: string; erdDir: string }} options - Build options.
 */
export async function prepareErdBuild(
  options: TailorDBSchemaOptions & { outputPath: string; erdDir: string },
): Promise<void> {
  await writeTblsSchemaToFile(options);

  await runLiamBuild(options.outputPath, options.erdDir);
}

export interface ErdBuildResult {
  namespace: string;
  erdSite?: string;
  schemaOutputPath: string;
  distDir: string;
  erdDir: string;
}

/**
 * Prepare ERD builds for one or more namespaces.
 * @param {{ client: OperatorClient; workspaceId: string; config: AppConfig; namespace?: string }} options - Build options.
 * @param {OperatorClient} options.client - Operator client.
 * @param {string} options.workspaceId - Workspace ID.
 * @param {AppConfig} options.config - Loaded Tailor config.
 * @param {string | undefined} options.namespace - Namespace override.
 * @returns {Promise<ErdBuildResult[]>} Build results by namespace.
 */
export async function prepareErdBuilds(options: {
  client: OperatorClient;
  workspaceId: string;
  config: AppConfig;
  namespace?: string;
}): Promise<ErdBuildResult[]> {
  const { client, workspaceId, config } = options;
  const baseDir = path.resolve(process.cwd(), DEFAULT_ERD_BASE_DIR);
  let targets: ErdBuildResult[];

  if (options.namespace) {
    const { namespace, erdSite } = resolveDbConfig(config, options.namespace);
    const erdDir = path.join(baseDir, namespace);
    targets = [
      {
        namespace,
        erdSite,
        schemaOutputPath: path.join(erdDir, "schema.json"),
        distDir: path.join(erdDir, "dist"),
        erdDir,
      },
    ];
  } else {
    const erdSites = resolveAllErdSites(config);
    if (erdSites.length === 0) {
      throw new Error(
        "No namespaces with erdSite configured found. " +
          'Add erdSite: "<static-website-name>" to db.<namespace> in tailor.config.ts.',
      );
    }
    logger.info(`Found ${erdSites.length} namespace(s) with erdSite configured.`);
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
      prepareErdBuild({
        namespace: target.namespace,
        client,
        workspaceId,
        outputPath: target.schemaOutputPath,
        erdDir: target.erdDir,
      }),
    ),
  );

  return targets;
}
