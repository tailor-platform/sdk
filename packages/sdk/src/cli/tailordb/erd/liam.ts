import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../../utils/logger";
import { resolveCliBinPath } from "../../utils/resolve-cli-bin";
import { DEFAULT_ERD_BASE_DIR } from "./constants";
import { resolveAllErdSites, resolveDbConfig } from "./db-config";
import { writeTblsSchemaToFile } from "./schema";
import type { TailorDBSchemaOptions } from "./schema";
import type { OperatorClient } from "../../client";
import type { AppConfig } from "@/configure/config";

/**
 * Run the liam CLI to build an ERD static site from a schema file.
 * @param {string} schemaPath - Path to the ERD schema JSON file
 * @param {string} cwd - Working directory where liam will run (dist is created here)
 * @returns {Promise<void>} Resolves when the build completes successfully
 */
async function runLiamBuild(schemaPath: string, cwd: string): Promise<void> {
  fs.mkdirSync(cwd, { recursive: true });

  return await new Promise<void>((resolve, reject) => {
    let liamBinPath: string;
    try {
      liamBinPath = resolveCliBinPath({
        cwd,
        packageName: "@liam-hq/cli",
        binName: "liam",
        installHint: "npm i -D @liam-hq/cli",
      });
    } catch (error) {
      logger.error(String(error));
      reject(error);
      return;
    }

    const child = spawn(
      process.execPath,
      [liamBinPath, "erd", "build", "--format", "tbls", "--input", schemaPath],
      {
        stdio: "inherit",
        cwd,
      },
    );

    child.on("error", (error) => {
      logger.error("Failed to run `@liam-hq/cli`. Ensure it is installed in your project.");
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        logger.error(
          "liam CLI exited with a non-zero code. Ensure `@liam-hq/cli erd build --format tbls --input schema.json` works in your project.",
        );
        reject(new Error(`liam CLI exited with code ${code ?? 1}`));
      }
    });
  });
}

/**
 * Export TailorDB schema and build ERD artifacts via liam.
 * @param {TailorDBSchemaOptions & { outputPath: string; erdDir: string }} options - Build options.
 */
async function prepareErdBuild(
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
 * @param {{ client: OperatorClient; workspaceId: string; config: AppConfig; namespace?: string; outputDir?: string }} options - Build options.
 * @param {OperatorClient} options.client - Operator client.
 * @param {string} options.workspaceId - Workspace ID.
 * @param {AppConfig} options.config - Loaded Tailor config.
 * @param {string | undefined} options.namespace - Namespace override.
 * @param {string | undefined} options.outputDir - Output directory override.
 * @returns {Promise<ErdBuildResult[]>} Build results by namespace.
 */
export async function prepareErdBuilds(options: {
  client: OperatorClient;
  workspaceId: string;
  config: AppConfig;
  namespace?: string;
  outputDir?: string;
}): Promise<ErdBuildResult[]> {
  const { client, workspaceId, config } = options;
  const baseDir = options.outputDir ?? path.resolve(process.cwd(), DEFAULT_ERD_BASE_DIR);
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
