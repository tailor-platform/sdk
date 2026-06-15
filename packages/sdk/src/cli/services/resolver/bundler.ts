import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { type BundleCache, computeBundlerContextHash, withCache } from "@/cli/cache/bundle-cache";
import { type FileLoadConfig, loadFilesWithIgnores } from "@/cli/services/file-loader";
import { removeStaleEntryFiles } from "@/cli/services/stale-cleanup";
import { withBundleConcurrency } from "@/cli/shared/bundle-concurrency";
import { createLogLevelTreeshakeOptions } from "@/cli/shared/bundle-log-level";
import { getDistDir } from "@/cli/shared/dist-dir";
import { composeFunctionTreeshakeOptions } from "@/cli/shared/function-treeshake";
import { logger, styles } from "@/cli/shared/logger";
import { platformBundleDefinePlugin } from "@/cli/shared/platform-bundle-plugin";
import { INVOKER_EXPR } from "@/cli/shared/runtime-exprs";
import {
  createTriggerTransformPlugin,
  serializeTriggerContext,
  type TriggerContext,
} from "@/cli/shared/trigger-context";
import ml from "@/utils/multiline";
import { loadResolver } from "./loader";
import type { LogLevel } from "@/configure/config/types";

interface ResolverInfo {
  name: string;
  sourceFile: string;
}

/**
 * Bundle resolvers for the specified namespace
 *
 * This function:
 * 1. Uses a transform plugin to add validation wrapper during bundling
 * 2. Creates entry file
 * 3. Bundles in a single step with tree-shaking
 * @param namespace - Resolver namespace name
 * @param config - Resolver file loading configuration
 * @param triggerContext - Trigger context for workflow/job transformations
 * @param cache - Optional bundle cache for skipping unchanged builds
 * @param inlineSourcemap - Whether to enable inline sourcemaps
 * @param bundleLogLevel - Controls which console calls are kept in bundled code
 * @returns Map of resolver name to bundled code
 */
export async function bundleResolvers(
  namespace: string,
  config: FileLoadConfig,
  triggerContext?: TriggerContext,
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
): Promise<Map<string, string>> {
  const bundledCode = new Map<string, string>();
  const files = loadFilesWithIgnores(config);
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
    });
  }

  const outputDir = path.resolve(getDistDir(), "resolvers");

  fs.mkdirSync(outputDir, { recursive: true });

  // Clean stale entry files from previous builds.
  // Must complete before Promise.all below; parallel namespace processing
  // would require separate output directories per namespace.
  await removeStaleEntryFiles(outputDir);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each resolver, capped by TAILOR_BUNDLE_CONCURRENCY to bound native
  // memory use (each rolldown.build allocates its own module graph).
  const results = await withBundleConcurrency(resolvers, (resolver) =>
    bundleSingleResolver(
      resolver,
      outputDir,
      tsconfig,
      triggerContext,
      cache,
      inlineSourcemap,
      bundleLogLevel,
    ),
  );

  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  logger.log(`${styles.success("Bundled")} ${styles.info(`"${namespace}"`)}`);

  return bundledCode;
}

async function bundleSingleResolver(
  resolver: ResolverInfo,
  outputDir: string,
  tsconfig: string | undefined,
  triggerContext?: TriggerContext,
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
): Promise<[string, string]> {
  const serializedTriggerContext = serializeTriggerContext(triggerContext);

  const contextHash = computeBundlerContextHash({
    sourceFile: resolver.sourceFile,
    serializedTriggerContext,
    tsconfig,
    inlineSourcemap,
    bundleLogLevel,
  });

  const code = await withCache({
    cache,
    kind: "resolver",
    name: resolver.name,
    sourceFile: resolver.sourceFile,
    contextHash,
    async build(cachePlugins) {
      // Step 1: Create entry file that imports from the original source
      const entryPath = path.join(outputDir, `${resolver.name}.entry.js`);
      const absoluteSourcePath = path.resolve(resolver.sourceFile);

      const entryContent = ml /* js */ `
        import _internalResolver from "${absoluteSourcePath}";
        import { t } from "@tailor-platform/sdk";

        const $tailor_resolver_body = async (context) => {
          const invoker = ${INVOKER_EXPR};
          if (_internalResolver.input) {
            const result = t.object(_internalResolver.input).parse({
              value: context.input,
              data: context.input,
              user: context.user,
            });

            if (result.issues) {
              throw new TailorErrors(result.issues.map(issue => ({
                message: issue.message,
                path: issue.path ?? [],
              })));
            }
          }

          return _internalResolver.body({ ...context, invoker });
        };

        export { $tailor_resolver_body as main };
      `;
      fs.writeFileSync(entryPath, entryContent);

      // Step 2: Bundle with tree-shaking (write: false to avoid unnecessary disk I/O)
      const triggerPlugin = createTriggerTransformPlugin(triggerContext);
      const plugins: rolldown.Plugin[] = triggerPlugin ? [triggerPlugin] : [];
      plugins.push(platformBundleDefinePlugin, ...cachePlugins);

      const result = await rolldown.build({
        input: entryPath,
        write: false,
        output: {
          format: "esm",
          sourcemap: inlineSourcemap ? "inline" : true,
          minify: inlineSourcemap
            ? {
                mangle: {
                  keepNames: true,
                },
              }
            : true,
          codeSplitting: false,
        },
        tsconfig,
        plugins,
        treeshake: composeFunctionTreeshakeOptions([
          createLogLevelTreeshakeOptions(bundleLogLevel),
        ]),
        logLevel: "silent",
      } as rolldown.BuildOptions);

      return result.output[0].code;
    },
  });

  return [resolver.name, code];
}
