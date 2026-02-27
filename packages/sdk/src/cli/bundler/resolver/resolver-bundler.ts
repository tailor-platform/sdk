import * as fs from "node:fs";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { loadFilesWithIgnores, type FileLoadConfig } from "@/cli/application/file-loader";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { createDepCollectorPlugin } from "@/cli/cache/dep-collector-plugin";
import { hashContent, hashFile } from "@/cli/cache/hasher";
import { getDistDir } from "@/cli/utils/dist-dir";
import { logger, styles } from "@/cli/utils/logger";
import {
  createTriggerTransformPlugin,
  serializeTriggerContext,
  type TriggerContext,
} from "../trigger-context";
import { loadResolver } from "./loader";
import type { BundleCache } from "@/cli/cache/bundle-cache";

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
 * @returns Promise that resolves when bundling completes
 */
export async function bundleResolvers(
  namespace: string,
  config: FileLoadConfig,
  triggerContext?: TriggerContext,
  cache?: BundleCache,
): Promise<void> {
  const files = loadFilesWithIgnores(config);
  if (files.length === 0) {
    logger.warn(`No resolver files found for patterns: ${config.files?.join(", ") ?? "(none)"}`);
    return;
  }

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(files.length.toString())} files for ${styles.info(`"${namespace}"`)}`,
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
  for (const file of fs.readdirSync(outputDir)) {
    if (file.endsWith(".entry.js")) {
      fs.rmSync(path.join(outputDir, file), { force: true });
    }
  }

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each resolver
  await Promise.all(
    resolvers.map((resolver) =>
      bundleSingleResolver(resolver, outputDir, tsconfig, triggerContext, cache),
    ),
  );

  logger.log(`${styles.success("Bundled")} ${styles.info(`"${namespace}"`)}`);
}

async function bundleSingleResolver(
  resolver: ResolverInfo,
  outputDir: string,
  tsconfig: string | undefined,
  triggerContext?: TriggerContext,
  cache?: BundleCache,
): Promise<void> {
  const outputPath = path.join(outputDir, `${resolver.name}.js`);

  // Include source file path, trigger context, tsconfig, and sourcemap mode
  // in context hash so that file relocation, workflow config changes, tsconfig
  // edits, or sourcemap mode toggle invalidate the cache.
  const sourceContext = cache
    ? hashContent(
        path.resolve(resolver.sourceFile) +
          serializeTriggerContext(triggerContext) +
          (tsconfig ? hashFile(tsconfig) : "") +
          String(enableInlineSourcemap),
      )
    : undefined;

  // Try to restore from cache before bundling
  if (
    cache?.tryRestore({
      kind: "resolver",
      name: resolver.name,
      outputPath,
      contextHash: sourceContext,
    })
  ) {
    logger.debug(`  ${styles.dim("cached")}: ${resolver.name}`);
    return;
  }

  // Step 1: Create entry file that imports from the original source
  const entryPath = path.join(outputDir, `${resolver.name}.entry.js`);
  const absoluteSourcePath = path.resolve(resolver.sourceFile);

  const entryContent = ml /* js */ `
    import _internalResolver from "${absoluteSourcePath}";
    import { t } from "@tailor-platform/sdk";

    const $tailor_resolver_body = async (context) => {
      if (_internalResolver.input) {
        const result = t.object(_internalResolver.input).parse({
          value: context.input,
          data: context.input,
          user: context.user,
        });

        if (result.issues) {
          const errorMessages = result.issues
            .map(issue => {
              const path = issue.path ? issue.path.join('.') : '';
              return path ? \`  \${path}: \${issue.message}\` : issue.message;
            })
            .join('\\n');
          throw new Error(\`Failed to input validation:\\n\${errorMessages}\`);
        }
      }

      return _internalResolver.body(context);
    };

    export { $tailor_resolver_body as main };
  `;
  fs.writeFileSync(entryPath, entryContent);

  // Step 2: Bundle with tree-shaking
  const triggerPlugin = createTriggerTransformPlugin(triggerContext);
  const plugins: rolldown.Plugin[] = triggerPlugin ? [triggerPlugin] : [];

  // Add dep-collector plugin for cache dependency tracking
  const depCollector = cache ? createDepCollectorPlugin() : undefined;
  if (depCollector) {
    plugins.push(depCollector.plugin);
  }

  await rolldown.build(
    rolldown.defineConfig({
      input: entryPath,
      output: {
        file: outputPath,
        format: "esm",
        sourcemap: enableInlineSourcemap ? "inline" : true,
        minify: enableInlineSourcemap
          ? {
              mangle: {
                keepNames: true,
              },
            }
          : true,
        inlineDynamicImports: true,
      },
      tsconfig,
      plugins,
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
      },
      logLevel: "silent",
    }) as rolldown.BuildOptions,
  );

  // Save to cache after successful build
  if (cache && depCollector) {
    cache.save({
      kind: "resolver",
      name: resolver.name,
      sourceFile: resolver.sourceFile,
      outputPath,
      dependencyPaths: depCollector.getResult(),
      contextHash: sourceContext,
    });
  }
}
