import * as path from "pathe";
import { createStartTransformPlugin } from "#/cli/services/workflow/start-transformer";
import { buildFunctionBundle, type FunctionBundleSettings } from "#/cli/shared/function-bundle";
import { logger, styles } from "#/cli/shared/logger";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import ml from "#/utils/multiline";

/**
 * Options for bundling auth hooks
 */
export interface BundleAuthHooksOptions extends FunctionBundleSettings {
  /** Absolute path to the config file that exports the auth definition */
  configPath: string;
  /** Auth namespace name */
  authName: string;
  /** Dot-path expression to reach the handler from the config's default export */
  handlerAccessPath: string;
  /** Environment variables to inject into the hook args */
  env?: Record<string, string | number | boolean>;
  /** Directory the tsconfig is resolved against */
  baseDir: string;
}

/**
 * Bundle a single auth hook handler.
 *
 * Follows the same pattern as the executor bundler:
 * 1. Generate an in-memory entry module that re-exports the handler as `main`
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
    startContext,
    bundleLogLevel = "DEBUG",
    baseDir,
  } = options;

  logger.newline();
  logger.log(`Bundling auth hook for ${styles.info(`"${authName}"`)}`);

  const tsconfig = await resolveTSConfigWithFallback(baseDir);

  const functionName = `auth-hook--${authName}--before-login`;

  const code = await buildFunctionBundle({
    ...options,
    kind: "auth-hook",
    name: functionName,
    sourceFile: path.resolve(configPath),
    tsconfig,
    env,
    define: { "process.env.TAILOR_APP_LOG_LEVEL": JSON.stringify(bundleLogLevel) },
    transform: () => createStartTransformPlugin(startContext),
    entry: (absoluteConfigPath) => ml /* js */ `
      import _config from "${absoluteConfigPath}";
      const __auth_hook_function = _config.${handlerAccessPath};
      export async function main(args) {
        const env = ${JSON.stringify(env)};
        return await __auth_hook_function({ ...args, env });
      }
    `,
  });

  logger.log(`${styles.success("Bundled")} auth hook for ${styles.info(`"${authName}"`)}`);

  const bundledCode = new Map<string, string>();
  bundledCode.set(functionName, code);
  return bundledCode;
}
