import * as fs from "node:fs";
import ml from "multiline-ts";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "@/cli/cache/bundle-cache";
import { removeStaleEntryFiles } from "@/cli/services/stale-cleanup";
import { getDistDir } from "@/cli/shared/dist-dir";
import { logger, styles } from "@/cli/shared/logger";
import {
  createTriggerTransformPlugin,
  serializeTriggerContext,
  type TriggerContext,
} from "@/cli/shared/trigger-context";

/**
 * Options for bundling auth hooks
 */
export interface BundleAuthHooksOptions {
  /** Absolute path to the config file that exports the auth definition */
  configPath: string;
  /** Auth namespace name */
  authName: string;
  /** Dot-path expression to reach the handler from the config's default export */
  handlerAccessPath: string;
  /** Trigger context for workflow/job transformations */
  triggerContext?: TriggerContext;
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
}

/**
 * Bundle a single auth hook handler into dist/auth-hooks/.
 *
 * Follows the same pattern as the executor bundler:
 * 1. Generate an entry file that re-exports the handler as `main`
 * 2. Bundle with rolldown + tree-shaking
 * @param options - Bundle options
 */
export async function bundleAuthHooks(options: BundleAuthHooksOptions): Promise<void> {
  const { configPath, authName, handlerAccessPath, triggerContext, cache, inlineSourcemap } =
    options;

  logger.newline();
  logger.log(`Bundling auth hook for ${styles.info(`"${authName}"`)}`);

  const outputDir = path.resolve(getDistDir(), "auth-hooks");
  fs.mkdirSync(outputDir, { recursive: true });

  await removeStaleEntryFiles(outputDir);

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  const functionName = `auth-hook--${authName}--before-login`;
  const outputPath = path.join(outputDir, `${functionName}.js`);
  const absoluteConfigPath = path.resolve(configPath);

  const serializedTriggerContext = serializeTriggerContext(triggerContext);
  const contextHash = computeBundlerContextHash({
    sourceFile: absoluteConfigPath,
    serializedTriggerContext,
    tsconfig,
    inlineSourcemap,
  });

  await withCache({
    cache,
    kind: "auth-hook",
    name: functionName,
    sourceFile: absoluteConfigPath,
    outputPath,
    contextHash,
    async build(cachePlugins) {
      const entryPath = path.join(outputDir, `${functionName}.entry.js`);

      const entryContent = ml /* js */ `
        import _config from "${absoluteConfigPath}";
        const __auth_hook_function = _config.${handlerAccessPath};
        export { __auth_hook_function as main };
      `;
      fs.writeFileSync(entryPath, entryContent);

      const triggerPlugin = createTriggerTransformPlugin(triggerContext);
      const plugins: rolldown.Plugin[] = triggerPlugin ? [triggerPlugin] : [];
      plugins.push(...cachePlugins);

      await rolldown.build(
        rolldown.defineConfig({
          input: entryPath,
          output: {
            file: outputPath,
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
          treeshake: {
            moduleSideEffects: false,
            annotations: true,
            unknownGlobalSideEffects: false,
          },
          logLevel: "silent",
        }) as rolldown.BuildOptions,
      );
    },
  });

  logger.log(`${styles.success("Bundled")} auth hook for ${styles.info(`"${authName}"`)}`);
}
