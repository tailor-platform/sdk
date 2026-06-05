import * as fs from "node:fs";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "@/cli/cache/bundle-cache";
import { removeStaleEntryFiles } from "@/cli/services/stale-cleanup";
import { createFunctionTreeshakeOptions } from "@/cli/shared/bundle-log-level";
import { getDistDir } from "@/cli/shared/dist-dir";
import { logger, styles } from "@/cli/shared/logger";
import {
  createTriggerTransformPlugin,
  serializeTriggerContext,
  type TriggerContext,
} from "@/cli/shared/trigger-context";
import ml from "@/utils/multiline";
import type { LogLevel } from "@/types/app-config";

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
  /** Environment variables to inject into the hook args */
  env?: Record<string, string | number | boolean>;
  /** Trigger context for workflow/job transformations */
  triggerContext?: TriggerContext;
  /** Optional bundle cache for skipping unchanged builds */
  cache?: BundleCache;
  /** Whether to enable inline sourcemaps */
  inlineSourcemap?: boolean;
  /** Controls which console calls are kept in bundled code */
  bundleLogLevel?: LogLevel;
}

/**
 * Bundle a single auth hook handler.
 *
 * Follows the same pattern as the executor bundler:
 * 1. Generate an entry file that re-exports the handler as `main`
 * 2. Bundle with rolldown + tree-shaking
 * @param options - Bundle options
 * @returns Map of function name to bundled code
 */
export async function bundleAuthHooks(
  options: BundleAuthHooksOptions,
): Promise<Map<string, string>> {
  const {
    configPath,
    authName,
    handlerAccessPath,
    env = {},
    triggerContext,
    cache,
    inlineSourcemap,
    bundleLogLevel = "DEBUG",
  } = options;

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
  const absoluteConfigPath = path.resolve(configPath);

  const serializedTriggerContext = serializeTriggerContext(triggerContext);

  // Include sorted env variables as a prefix so that env changes invalidate the cache
  const sortedEnvPrefix = JSON.stringify(
    Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))),
  );
  const contextHash = computeBundlerContextHash({
    sourceFile: absoluteConfigPath,
    serializedTriggerContext,
    tsconfig,
    inlineSourcemap,
    bundleLogLevel,
    prefix: sortedEnvPrefix,
  });

  const code = await withCache({
    cache,
    kind: "auth-hook",
    name: functionName,
    sourceFile: absoluteConfigPath,
    contextHash,
    async build(cachePlugins) {
      const entryPath = path.join(outputDir, `${functionName}.entry.js`);

      const entryContent = ml /* js */ `
        import _config from "${absoluteConfigPath}";
        const __auth_hook_function = _config.${handlerAccessPath};
        export async function main(args) {
          const env = ${JSON.stringify(env)};
          return await __auth_hook_function({ ...args, env });
        }
      `;
      fs.writeFileSync(entryPath, entryContent);

      const triggerPlugin = createTriggerTransformPlugin(triggerContext);
      const plugins: rolldown.Plugin[] = triggerPlugin ? [triggerPlugin] : [];
      plugins.push(...cachePlugins);

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
        treeshake: createFunctionTreeshakeOptions(bundleLogLevel),
        logLevel: "silent",
      } as rolldown.BuildOptions);

      return result.output[0].code;
    },
  });

  logger.log(`${styles.success("Bundled")} auth hook for ${styles.info(`"${authName}"`)}`);

  const bundledCode = new Map<string, string>();
  bundledCode.set(functionName, code);
  return bundledCode;
}
