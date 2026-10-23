import { type FileLoadConfig, loadFilesWithIgnores } from "#/cli/services/file-loader";
import { buildFunctionBundle, type FunctionBundleSettings } from "#/cli/services/function-bundle";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { logger, styles } from "#/cli/shared/logger";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import {
  buildResolverResultSerialization,
  buildResolverValidatedInputExpr,
  INVOKER_EXPR,
  resolverDateRepresentations,
} from "#/cli/shared/runtime-exprs";
import ml from "#/utils/multiline";
import { loadResolver } from "./loader";
import type { AllowedRuntimeGlobals } from "#/configure/config/types";
import type { Resolver } from "#/types/resolver.generated";

interface ResolverInfo {
  name: string;
  sourceFile: string;
  permission: Resolver["permission"];
  input: Resolver["input"];
  output: Resolver["output"];
}

export interface BundleResolversOptions extends FunctionBundleSettings {
  /** Resolver namespace name */
  namespace: string;
  /** Resolver file loading configuration */
  config: FileLoadConfig;
  /** Directory the config's file patterns are resolved against */
  baseDir: string;
  /** The namespace's `defaultPermission`, applied to resolvers declaring none */
  defaultPermission?: Resolver["permission"];
  /** Globals each installed package may reference */
  allowedRuntimeGlobals?: AllowedRuntimeGlobals;
}

/**
 * Bundle resolvers for the specified namespace
 *
 * This function:
 * 1. Uses a transform plugin to add validation wrapper during bundling
 * 2. Creates an in-memory entry module
 * 3. Bundles in a single step with tree-shaking
 * @param options - Bundle options
 * @returns Map of resolver name to bundled code
 */
export async function bundleResolvers(
  options: BundleResolversOptions,
): Promise<Map<string, string>> {
  const {
    namespace,
    config,
    baseDir,
    defaultPermission,
    allowedRuntimeGlobals,
    dateDefault = "legacy",
  } = options;
  const bundledCode = new Map<string, string>();
  const files = loadFilesWithIgnores(config, baseDir);
  if (files.length === 0) {
    logger.warn(`No resolver files found for patterns: ${config.files.join(", ")}`);
    return bundledCode;
  }

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(files.length.toString())} files for ${styles.info(
      `"${namespace}"`,
    )}`,
  );

  // Load all resolvers to get their names
  const resolvers: ResolverInfo[] = [];
  for (const file of files) {
    const resolver = await loadResolver(file);
    if (!resolver) {
      logger.debug(`  Skipping: ${file} (could not be loaded)`);
      continue;
    }
    resolvers.push({
      name: resolver.name,
      sourceFile: file,
      permission: resolver.permission,
      input: resolver.input,
      output: resolver.output,
    });
  }

  const tsconfig = await resolveTSConfigWithFallback(baseDir);

  // Process each resolver, capped by TAILOR_BUNDLE_CONCURRENCY to bound native
  // memory use (each rolldown.build allocates its own module graph).
  const results = await withBundleConcurrency(resolvers, async (resolver) => {
    const code = await buildFunctionBundle({
      ...options,
      kind: "resolver",
      namespace,
      name: resolver.name,
      sourceFile: resolver.sourceFile,
      tsconfig,
      dateDefault,
      dateRepresentations: resolverDateRepresentations(resolver, dateDefault),
      runtimeGlobals: { label: `Resolver "${resolver.name}"`, allowed: allowedRuntimeGlobals },
      entry: (absoluteSourcePath) => {
        const validatedInputExpr = buildResolverValidatedInputExpr({
          permission: resolver.permission,
          defaultPermission,
        });
        const { importStatement, resultExpr } = buildResolverResultSerialization(
          resolver.output,
          dateDefault,
        );
        return ml /* js */ `
          import _internalResolver from "${absoluteSourcePath}";
          import { t } from "@tailor-platform/sdk";
          ${importStatement}

          const $tailor_resolver_body = async (context) => {
            const invoker = ${INVOKER_EXPR};
            const input = ${validatedInputExpr};
            const result = await _internalResolver.body({ ...context, input, invoker });
            return ${resultExpr};
          };

          export { $tailor_resolver_body as main };
        `;
      },
    });
    return [resolver.name, code] as const;
  });

  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  logger.log(`${styles.success("Bundled")} ${styles.info(`"${namespace}"`)}`);

  return bundledCode;
}
