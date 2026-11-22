import * as path from "pathe";
import { loadFilesWithIgnores } from "#/cli/services/file-loader";
import { isLoadedWorkspaceConfig } from "./config-loader";
import type { FileLoadConfig } from "#/cli/services/file-loader";
import type { EnvValue } from "#/configure/config/types";
import type { LoadedConfig, LoadedWorkspaceConfig } from "./config-loader";

/** Kind of function a file defines, which picks the service whose `env` override applies. */
export type FunctionEnvKind = "resolver" | "executor" | "workflow-job" | "plain";

/**
 * The `env` a function runs with: the root `env`, with the override of its workspace service laid
 * over it. A resolver takes the override of the resolver namespace whose files hold it; an executor
 * or workflow job, that of the executor or workflow service, as deploy bundles them.
 * @param config - Loaded config of either kind
 * @param kind - Kind of function the file defines
 * @param filePath - Path of the function's file
 * @returns The env values the function receives
 */
export function functionEnv(
  config: LoadedConfig | LoadedWorkspaceConfig,
  kind: FunctionEnvKind,
  filePath: string,
): Record<string, EnvValue> {
  if (!isLoadedWorkspaceConfig(config)) return config.env ?? {};
  const baseDir = path.dirname(config.path);
  const target = path.resolve(filePath);
  const holds = (files: FileLoadConfig | undefined) =>
    files !== undefined &&
    loadFilesWithIgnores(files, baseDir).some((file) => path.resolve(file) === target);
  const { envOverrides } = config;
  const override =
    kind === "resolver"
      ? Object.entries(config.resolver).find(([, service]) => holds(service))?.[0]
      : undefined;
  const overrides =
    override !== undefined
      ? envOverrides.resolver[override]
      : kind === "executor"
        ? envOverrides.executor
        : kind === "workflow-job"
          ? envOverrides.workflow
          : undefined;
  return { ...config.env, ...overrides };
}
