import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { defineCommand } from "citty";
import * as path from "pathe";
import { commonArgs, deploymentArgs, jsonArgs, withCommonArgs } from "../../args";
import { logger } from "../../utils/logger";
import { resolveCliBinPath } from "../../utils/resolve-cli-bin";
import { writeTblsSchemaToFile } from "./schema";
import { initErdContext } from "./utils";
import type { TailorDBSchemaOptions } from "./schema";
import type { OperatorClient } from "../../client";
import type { AppConfig } from "@/parser/app-config";

const DEFAULT_ERD_BASE_DIR = ".tailor-sdk/erd";

/**
 * Resolve TailorDB config and namespace.
 * @param config - Loaded Tailor SDK config.
 * @param explicitNamespace - Namespace override.
 * @returns Resolved namespace and erdSite.
 */
function resolveDbConfig(
  config: AppConfig,
  explicitNamespace?: string,
): { namespace: string; erdSite: string | undefined } {
  const namespace = explicitNamespace ?? Object.keys(config.db ?? {})[0];

  if (!namespace) {
    throw new Error(
      "No TailorDB namespaces found in config. Please define db services in tailor.config.ts or pass --namespace.",
    );
  }

  const dbConfig = config.db?.[namespace];

  if (!dbConfig || typeof dbConfig !== "object" || "external" in dbConfig) {
    throw new Error(`TailorDB namespace "${namespace}" not found in config.db.`);
  }

  return { namespace, erdSite: dbConfig.erdSite };
}

/**
 * Get all namespaces with erdSite configured.
 * @param config - Loaded Tailor SDK config.
 * @returns Namespaces with erdSite.
 */
function resolveAllErdSites(config: AppConfig): Array<{ namespace: string; erdSite: string }> {
  const results: Array<{ namespace: string; erdSite: string }> = [];

  for (const [namespace, dbConfig] of Object.entries(config.db ?? {})) {
    if (dbConfig && typeof dbConfig === "object" && !("external" in dbConfig) && dbConfig.erdSite) {
      results.push({ namespace, erdSite: dbConfig.erdSite });
    }
  }

  return results;
}

/**
 * Get all namespaces (regardless of erdSite configuration).
 * @param config - Loaded Tailor SDK config.
 * @returns All namespaces with optional erdSite.
 */
function resolveAllNamespaces(
  config: AppConfig,
): Array<{ namespace: string; erdSite: string | undefined }> {
  const results: Array<{ namespace: string; erdSite: string | undefined }> = [];

  for (const [namespace, dbConfig] of Object.entries(config.db ?? {})) {
    if (dbConfig && typeof dbConfig === "object" && !("external" in dbConfig)) {
      results.push({ namespace, erdSite: dbConfig.erdSite });
    }
  }

  return results;
}

/**
 * Run the liam CLI to build an ERD static site from a schema file.
 * @param schemaPath - Path to the ERD schema JSON file
 * @param cwd - Working directory where liam will run (dist is created here)
 * @returns Resolves when the build completes successfully
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
        stdio: "pipe",
        cwd,
      },
    );

    let stderrOutput = "";
    child.stderr?.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
    });

    child.on("error", (error) => {
      logger.error("Failed to run `@liam-hq/cli`. Ensure it is installed in your project.");
      reject(error);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        if (stderrOutput) {
          logger.error(stderrOutput);
        }
        logger.error(
          "liam CLI exited with a non-zero code. Ensure `@liam-hq/cli erd build --format tbls --input schema.json` works in your project.",
        );
        reject(new Error(`liam CLI exited with code ${code ?? 1}`));
      }
    });
  });
}

type ErdBuildOptions = TailorDBSchemaOptions & {
  outputPath: string;
  erdDir: string;
};

type ErdBuildsOptions = {
  client: OperatorClient;
  workspaceId: string;
  config: AppConfig;
  namespace?: string;
  outputDir?: string;
  requireErdSite?: boolean;
};

/**
 * Export TailorDB schema and build ERD artifacts via liam.
 * @param options - Build options.
 */
async function prepareErdBuild(options: ErdBuildOptions): Promise<void> {
  await writeTblsSchemaToFile(options);

  await runLiamBuild(options.outputPath, options.erdDir);

  const distDir = path.join(options.erdDir, "dist");
  const relativePath = path.relative(process.cwd(), distDir);
  logger.success(`Built ERD to ${relativePath}`);
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
 * @param options - Build options.
 * @returns Build results by namespace.
 */
export async function prepareErdBuilds(options: ErdBuildsOptions): Promise<ErdBuildResult[]> {
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
    const namespaces = options.requireErdSite
      ? resolveAllErdSites(config)
      : resolveAllNamespaces(config);
    if (namespaces.length === 0) {
      throw new Error(
        options.requireErdSite
          ? "No namespaces with erdSite configured found. " +
              'Add erdSite: "<static-website-name>" to db.<namespace> in tailor.config.ts.'
          : "No TailorDB namespaces found in config. Please define db services in tailor.config.ts.",
      );
    }
    logger.info(
      `Found ${namespaces.length} namespace(s)${options.requireErdSite ? " with erdSite configured" : ""}.`,
    );
    targets = namespaces.map(({ namespace, erdSite }) => {
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

export const erdExportCommand = defineCommand({
  meta: {
    name: "export",
    description: "Export Liam ERD dist from applied TailorDB schema (beta)",
  },
  args: {
    ...commonArgs,
    ...deploymentArgs,
    ...jsonArgs,
    namespace: {
      type: "string",
      description: "TailorDB namespace name (optional if only one namespace is defined in config)",
      alias: "n",
    },
    output: {
      type: "string",
      description:
        "Output directory path for tbls-compatible ERD JSON (writes to <outputDir>/<namespace>/schema.json)",
      alias: "o",
      default: DEFAULT_ERD_BASE_DIR,
    },
  },
  run: withCommonArgs(async (args) => {
    const { client, workspaceId, config } = await initErdContext(args);
    const outputDir = path.resolve(process.cwd(), String(args.output));

    const results = await prepareErdBuilds({
      client,
      workspaceId,
      config,
      namespace: args.namespace,
      outputDir,
    });

    logger.newline();
    if (args.json) {
      logger.out(
        results.map((result) => ({
          namespace: result.namespace,
          distDir: result.distDir,
          schemaOutputPath: result.schemaOutputPath,
        })),
      );
    } else {
      for (const result of results) {
        logger.out(`Exported ERD for namespace "${result.namespace}"`);
        logger.out(`  - Liam ERD dist: ${result.distDir}`);
        logger.out(`  - tbls schema.json: ${result.schemaOutputPath}`);
      }
    }
  }),
});
