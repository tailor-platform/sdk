import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { logger } from "@/cli/shared/logger";
import { loadLocalErdSchema, type LocalErdSchemaContext } from "./local-schema";
import { buildTailorDbErdSchema } from "./schema";
import { initErdCommand } from "./utils";
import { writeViewerDist } from "./viewer";
import type { TailorDBNamespaceData } from "@/types/plugin-generation";

const DEFAULT_ERD_BASE_DIR = ".tailor-sdk/erd";

interface ResolveTargetsOptions {
  context: LocalErdSchemaContext;
  namespace?: string;
  outputDir: string;
  requireErdSite?: boolean;
}

interface ErdTarget {
  namespaceData: TailorDBNamespaceData;
  erdSite?: string;
  schemaOutputPath: string;
  distDir: string;
  erdDir: string;
}

interface ErdBuildsOptions {
  configPath?: string;
  namespace?: string;
  outputDir?: string;
  requireErdSite?: boolean;
}

interface ErdBuildsFromContextOptions {
  context: LocalErdSchemaContext;
  namespace?: string;
  outputDir?: string;
  requireErdSite?: boolean;
}

export interface ErdBuildResult {
  namespace: string;
  erdSite?: string;
  schemaOutputPath: string;
  distDir: string;
  erdDir: string;
}

function getErdSite(context: LocalErdSchemaContext, namespace: string): string | undefined {
  const dbConfig = context.config.db?.[namespace];
  if (!dbConfig || "external" in dbConfig) {
    return undefined;
  }
  return dbConfig.erdSite;
}

function resolveExplicitTarget(options: ResolveTargetsOptions): ErdTarget {
  const namespaceData = options.context.namespaces.find(
    (candidate) => candidate.namespace === options.namespace,
  );
  if (!namespaceData) {
    const available = options.context.namespaces.map((candidate) => candidate.namespace).join(", ");
    throw new Error(
      `TailorDB namespace "${options.namespace}" not found in local config.db.` +
        (available ? ` Available owned namespaces: ${available}` : ""),
    );
  }

  const erdSite = getErdSite(options.context, namespaceData.namespace);
  if (options.requireErdSite && !erdSite) {
    throw new Error(
      `No erdSite configured for namespace "${namespaceData.namespace}". ` +
        `Add erdSite: "<static-website-name>" to db.${namespaceData.namespace} in tailor.config.ts.`,
    );
  }

  return toTarget(options.outputDir, namespaceData, erdSite);
}

function resolveAllTargets(options: ResolveTargetsOptions): ErdTarget[] {
  const namespaces = options.context.namespaces.filter(
    (namespaceData) =>
      !options.requireErdSite || getErdSite(options.context, namespaceData.namespace),
  );
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
  return namespaces.map((namespaceData) =>
    toTarget(
      options.outputDir,
      namespaceData,
      getErdSite(options.context, namespaceData.namespace),
    ),
  );
}

function toTarget(
  outputDir: string,
  namespaceData: TailorDBNamespaceData,
  erdSite: string | undefined,
): ErdTarget {
  const erdDir = path.join(outputDir, namespaceData.namespace);
  const distDir = path.join(erdDir, "dist");
  return {
    namespaceData,
    erdSite,
    schemaOutputPath: path.join(distDir, "schema.json"),
    distDir,
    erdDir,
  };
}

function resolveTargets(options: ResolveTargetsOptions): ErdTarget[] {
  if (options.namespace) {
    return [resolveExplicitTarget(options)];
  }
  return resolveAllTargets(options);
}

function prepareErdBuild(target: ErdTarget): ErdBuildResult {
  const schema = buildTailorDbErdSchema({ namespaceData: target.namespaceData });
  writeViewerDist({ schema, distDir: target.distDir });

  const relativePath = path.relative(process.cwd(), target.distDir);
  logger.success(`Built ERD to ${relativePath}`);

  return {
    namespace: target.namespaceData.namespace,
    erdSite: target.erdSite,
    schemaOutputPath: target.schemaOutputPath,
    distDir: target.distDir,
    erdDir: target.erdDir,
  };
}

/**
 * Prepare TailorDB ERD static viewer builds for one or more namespaces.
 * @param options - Build options.
 * @returns Build results by namespace.
 */
export async function prepareErdBuilds(options: ErdBuildsOptions): Promise<ErdBuildResult[]> {
  const context = await loadLocalErdSchema({
    configPath: options.configPath,
    namespaces: options.namespace ? [options.namespace] : undefined,
    requireErdSite: options.requireErdSite,
  });
  return prepareErdBuildsFromContext({
    context,
    namespace: options.namespace,
    outputDir: options.outputDir,
    requireErdSite: options.requireErdSite,
  });
}

/**
 * Prepare TailorDB ERD static viewer builds from an already loaded schema context.
 * @param options - Build options.
 * @returns Build results by namespace.
 */
export function prepareErdBuildsFromContext(
  options: ErdBuildsFromContextOptions,
): ErdBuildResult[] {
  const outputDir = path.resolve(process.cwd(), options.outputDir ?? DEFAULT_ERD_BASE_DIR);
  const targets = resolveTargets({
    context: options.context,
    namespace: options.namespace,
    outputDir,
    requireErdSite: options.requireErdSite,
  });

  return targets.map((target) => prepareErdBuild(target));
}

export const erdExportCommand = defineAppCommand({
  name: "export",
  description: "Export TailorDB ERD static viewer from local TailorDB schema.",
  args: z
    .object({
      ...configArg,
      namespace: arg(z.string().optional(), {
        alias: "n",
        description:
          "TailorDB namespace name (optional if only one namespace is defined in config)",
      }),
      output: arg(z.string().default(DEFAULT_ERD_BASE_DIR), {
        alias: "o",
        description:
          "Output directory path for TailorDB ERD viewer files (writes to `<outputDir>/<namespace>/dist`)",
        completion: { type: "directory" },
      }),
    })
    .strict(),
  run: async (args) => {
    initErdCommand();

    const results = await prepareErdBuilds({
      configPath: args.config,
      namespace: args.namespace,
      outputDir: args.output,
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
        logger.out(`  - ERD viewer dist: ${result.distDir}`);
        logger.out(`  - TailorDB ERD schema: ${result.schemaOutputPath}`);
      }
    }
  },
});
