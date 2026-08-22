import { configArg } from "@tailor-platform/sdk/cli";
import { defineAppCommand } from "@tailor-platform/sdk/cli";
import { logger } from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { loadLocalErdSchema, type LocalErdSchemaContext } from "./local-schema";
import { buildTailorDbErdSchema } from "./schema";
import { initErdCommand } from "./utils";
import { writeViewerDist } from "./viewer";
import type { TailorDBNamespaceData } from "@tailor-platform/sdk/cli";

const DEFAULT_ERD_BASE_DIR = ".tailor/erd";

interface ResolveTargetsOptions {
  context: LocalErdSchemaContext;
  namespace?: string;
  outputDir: string;
  requireErdSite?: boolean;
}

interface ErdTarget {
  namespaceData: TailorDBNamespaceData;
  erdSite?: string;
  distDir: string;
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
  distDir: string;
}

export interface DeployableErdBuildResult extends ErdBuildResult {
  erdSite: string;
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

  const erdSite = options.context.sites[namespaceData.namespace];
  if (options.requireErdSite && !erdSite) {
    throw new Error(
      `No ERD site configured for namespace "${namespaceData.namespace}". ` +
        `Add sites: { "${namespaceData.namespace}": "<static-website-name>" } to the tailordbErdPlugin() entry in definePlugins() in tailor.config.ts.`,
    );
  }

  return toTarget(options.outputDir, namespaceData, erdSite);
}

function resolveAllTargets(options: ResolveTargetsOptions): ErdTarget[] {
  const namespaces = options.context.namespaces.filter(
    (namespaceData) => !options.requireErdSite || options.context.sites[namespaceData.namespace],
  );
  if (namespaces.length === 0) {
    throw new Error(
      options.requireErdSite
        ? "No namespaces with an ERD site configured found. " +
            'Add tailordbErdPlugin({ sites: { "<namespace>": "<static-website-name>" } }) to definePlugins() in tailor.config.ts.'
        : "No TailorDB namespaces found in config. Please define db services in tailor.config.ts.",
    );
  }

  logger.info(
    `Found ${namespaces.length} namespace(s)${options.requireErdSite ? " with an ERD site configured" : ""}.`,
  );
  return namespaces.map((namespaceData) =>
    toTarget(options.outputDir, namespaceData, options.context.sites[namespaceData.namespace]),
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
    distDir,
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
    distDir: target.distDir,
  };
}

/**
 * Prepare TailorDB ERD static viewer builds for one or more namespaces.
 * With `requireErdSite: true`, target resolution throws for namespaces without
 * an ERD site, so every result carries one.
 * @param options - Build options.
 * @returns Build results by namespace.
 */
export async function prepareErdBuilds(
  options: ErdBuildsOptions & { requireErdSite: true },
): Promise<DeployableErdBuildResult[]>;
export async function prepareErdBuilds(options: ErdBuildsOptions): Promise<ErdBuildResult[]>;
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
  args: z.strictObject({
    ...configArg,
    namespace: arg(z.string().optional(), {
      alias: "n",
      description: "TailorDB namespace name (optional if only one namespace is defined in config)",
    }),
    output: arg(z.string().default(DEFAULT_ERD_BASE_DIR), {
      alias: "o",
      description:
        "Output directory path for TailorDB ERD viewer files (writes to `<outputDir>/<namespace>/dist`)",
      completion: { type: "directory" },
    }),
  }),
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
        })),
      );
    } else {
      for (const result of results) {
        logger.out(`Exported ERD for namespace "${result.namespace}"`);
        logger.out(`  - ERD viewer: ${path.join(result.distDir, "index.html")}`);
      }
    }
  },
});
