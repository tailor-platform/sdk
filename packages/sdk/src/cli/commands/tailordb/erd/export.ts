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
}

interface ErdBuildsOptions {
  configPath?: string;
  namespace?: string;
  outputDir?: string;
  requireErdSite?: boolean;
  inline?: boolean;
}

interface ErdBuildsFromContextOptions {
  context: LocalErdSchemaContext;
  namespace?: string;
  outputDir?: string;
  requireErdSite?: boolean;
  inline?: boolean;
}

export interface ErdBuildResult {
  namespace: string;
  erdSite?: string;
  schemaOutputPath: string;
  distDir: string;
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
  const distDir = path.join(outputDir, namespaceData.namespace, "dist");
  return {
    namespaceData,
    erdSite,
    schemaOutputPath: path.join(distDir, "schema.json"),
    distDir,
  };
}

function resolveTargets(options: ResolveTargetsOptions): ErdTarget[] {
  if (options.namespace) {
    return [resolveExplicitTarget(options)];
  }
  return resolveAllTargets(options);
}

function prepareErdBuild(target: ErdTarget, inline?: boolean): ErdBuildResult {
  const schema = buildTailorDbErdSchema({ namespaceData: target.namespaceData });
  writeViewerDist({ schema, distDir: target.distDir, inline });

  const relativePath = path.relative(process.cwd(), target.distDir);
  logger.success(`Built ERD to ${relativePath}`);

  return {
    namespace: target.namespaceData.namespace,
    erdSite: target.erdSite,
    schemaOutputPath: target.schemaOutputPath,
    distDir: target.distDir,
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
    inline: options.inline,
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

  return targets.map((target) => prepareErdBuild(target, options.inline));
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
      inline: arg(z.boolean().default(false), {
        description:
          "Emit a single self-contained index.html (inlined CSS/JS and embedded schema) instead of multi-file dist",
      }),
    })
    .strict(),
  run: async (args) => {
    initErdCommand();

    const results = await prepareErdBuilds({
      configPath: args.config,
      namespace: args.namespace,
      outputDir: args.output,
      inline: args.inline,
    });

    logger.newline();
    if (args.json) {
      logger.out(
        results.map((result) => ({
          namespace: result.namespace,
          distDir: result.distDir,
          // Inline builds emit only index.html, so there is no schema.json path.
          ...(args.inline ? {} : { schemaOutputPath: result.schemaOutputPath }),
        })),
      );
    } else {
      for (const result of results) {
        logger.out(`Exported ERD for namespace "${result.namespace}"`);
        logger.out(`  - ERD viewer dist: ${result.distDir}`);
        if (!args.inline) {
          logger.out(`  - TailorDB ERD schema: ${result.schemaOutputPath}`);
        }
      }
    }
  },
});
