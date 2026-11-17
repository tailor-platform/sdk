import { createHash } from "node:crypto";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { DEFAULT_CONFIG_PATH } from "#/cli/shared/args";
import { loadConfig } from "#/cli/shared/config-loader";
import { errorSummary } from "#/cli/shared/errors";
import { readPackageJson } from "#/cli/shared/package-json";
import { KYSELY_FILE_NAME, REGISTRY_FILE_NAME } from "#/cli/shared/tailor-file-extension";
import { loadConfigNamespaces } from "#/cli/shared/tailordb-namespaces";
import { generateTypeDefinitionFromConfig } from "#/cli/shared/type-generator";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { generateKyselyTypesSource } from "#/plugin/builtin/kysely-type/type-processor";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { collectLoadedFiles } from "./loaded-files";
import { initializeResult, type ContentMapperHandlers, type PositionEncoding } from "./protocol";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { Plugin } from "#/plugin/types";

interface OpenProjectParams {
  configFileName: string;
  projectHandle: string;
  options?: Record<string, unknown>;
}

interface TransformParams {
  fileName: string;
  content: string;
  projectHandle: string;
}

interface Project {
  registryTypes?: string;
  kyselyTypes?: string;
  kyselyError?: string;
  error?: string;
  identity: string;
  watchedFiles: string[];
}

const KYSELY_PLUGIN_MISSING =
  "kyselyTypePlugin is not configured with contentMapper: true in tailor.config.ts";
const EMPTY_MODULE = "export {};\n";
const PROJECT_DIAGNOSTIC_CODE = 2;
const OPTION_DIAGNOSTIC_CODE = 3;
const ATOM_SPAN = 1;
const DEFINITION_FEATURES = (1 << 3) | (1 << 4);
const PROJECT_NOT_OPENED = "The project was not opened; restart the TypeScript server";

function configCandidates(searchFrom: string, foundIn?: string): string[] {
  const candidates: string[] = [];
  for (let dir = searchFrom; dir !== foundIn; dir = path.dirname(dir)) {
    candidates.push(path.join(dir, DEFAULT_CONFIG_PATH));
    if (path.dirname(dir) === dir) break;
  }
  return candidates;
}

export interface Evaluation {
  registryTypes?: string;
  kyselyTypes?: string;
  kyselyError?: string;
  error?: string;
  files: string[];
}

async function kyselyTypesOf(
  config: LoadedConfig,
  plugins: Plugin[],
): Promise<Pick<Evaluation, "kyselyTypes" | "kyselyError">> {
  const options = resolvePluginConfig(plugins, KyselyGeneratorID);
  if (options?.contentMapper !== true) return {};
  try {
    const { namespaces } = await loadConfigNamespaces(config, plugins, undefined, {
      precompileScripts: false,
    });
    return { kyselyTypes: await generateKyselyTypesSource(namespaces, options.temporal ?? false) };
  } catch (error) {
    return { kyselyError: errorSummary(error) };
  }
}

export type EvaluateConfig = (configPath: string) => Promise<Evaluation>;

/**
 * Evaluate `tailor.config.ts` in this process and collect the project files it imports.
 * @param configPath - Path of `tailor.config.ts`
 * @returns The registry types, or the error that stopped the config from loading, and the files imported
 */
export async function evaluateConfigInProcess(configPath: string): Promise<Evaluation> {
  const cwd = process.cwd();
  try {
    process.chdir(path.dirname(configPath));
    beginUserModuleRun();
    const { outcome, files } = await collectLoadedFiles(async () => {
      const { config, plugins } = await loadConfig(configPath);
      return {
        registryTypes: generateTypeDefinitionFromConfig(config),
        ...(await kyselyTypesOf(config, plugins)),
      };
    });
    return outcome.status === "rejected"
      ? { error: errorSummary(outcome.reason), files }
      : { ...outcome.value, files };
  } finally {
    process.chdir(cwd);
  }
}

async function loadProject(
  tsconfigPath: string,
  previousWatchedFiles: string[] | undefined,
  evaluate: EvaluateConfig,
): Promise<Omit<Project, "identity"> & { configPath?: string }> {
  const searchFrom = path.dirname(tsconfigPath);
  const configPath = findUpSync(DEFAULT_CONFIG_PATH, { cwd: searchFrom });
  if (!configPath) {
    return {
      error: `No ${DEFAULT_CONFIG_PATH} found in ${searchFrom} or its parent directories`,
      watchedFiles: configCandidates(searchFrom),
    };
  }
  const { registryTypes, kyselyTypes, kyselyError, error, files } = await evaluate(configPath);
  const watchedFiles = [
    ...new Set([...configCandidates(searchFrom, path.dirname(configPath)), configPath, ...files]),
  ];
  const keptWatchedFiles = [...new Set([...(previousWatchedFiles ?? []), ...watchedFiles])];
  if (registryTypes === undefined) {
    return { configPath, error, watchedFiles: keptWatchedFiles };
  }
  return {
    configPath,
    registryTypes,
    kyselyTypes,
    kyselyError,
    watchedFiles: kyselyError === undefined ? watchedFiles : keptWatchedFiles,
  };
}

function typesOf(
  fileName: string,
  project: Project | undefined,
): { text: string; problem?: string } {
  if (project?.registryTypes === undefined) {
    return { text: EMPTY_MODULE, problem: project?.error ?? PROJECT_NOT_OPENED };
  }
  if (fileName === REGISTRY_FILE_NAME) return { text: project.registryTypes };
  if (fileName !== KYSELY_FILE_NAME) return { text: EMPTY_MODULE };
  return project.kyselyTypes === undefined
    ? { text: EMPTY_MODULE, problem: project.kyselyError ?? KYSELY_PLUGIN_MISSING }
    : { text: project.kyselyTypes };
}

/**
 * Create the handlers of the content mapper that types `.tailor` files for
 * TypeScript from the project's `tailor.config.ts`.
 * @param evaluate - Evaluates the config
 * @returns A handler for each method of the content mapper protocol
 */
export function createContentMapperHandlers(evaluate: EvaluateConfig): ContentMapperHandlers {
  let encoding: PositionEncoding = "utf-16";
  const projects = new Map<string, Project>();
  const lastWatchedFiles = new Map<string, string[]>();
  const position = (content: string, offset: number): number =>
    encoding === "utf-16" ? offset : Buffer.byteLength(content.slice(0, offset));

  return {
    initialize(params) {
      const result = initializeResult(params);
      encoding = result.positionEncoding;
      return result;
    },

    async openProject(params) {
      const { configFileName, projectHandle, options } = params as OpenProjectParams;
      const loaded = await loadProject(
        configFileName,
        lastWatchedFiles.get(configFileName),
        evaluate,
      );
      if (loaded.registryTypes !== undefined) {
        lastWatchedFiles.set(configFileName, loaded.watchedFiles);
      }
      const { version } = await readPackageJson();
      const identity = createHash("sha256")
        .update(
          JSON.stringify([
            version,
            loaded.configPath ?? null,
            loaded.error ?? null,
            loaded.registryTypes ?? null,
            loaded.kyselyTypes ?? null,
            loaded.kyselyError ?? null,
          ]),
        )
        .digest("hex");
      projects.set(projectHandle, { ...loaded, identity });
      return {
        configIdentity: identity,
        watchedFiles: loaded.watchedFiles,
        optionDiagnostics: Object.keys(options ?? {}).map((key) => ({
          path: [key],
          messageText: `@tailor-platform/sdk's content mapper takes no options; it reads ${DEFAULT_CONFIG_PATH}`,
          code: OPTION_DIAGNOSTIC_CODE,
        })),
      };
    },

    transform(params) {
      const { fileName, content, projectHandle } = params as TransformParams;
      const project = projects.get(projectHandle);
      const { text, problem } = typesOf(path.basename(fileName), project);
      return {
        extension: ".ts",
        text,
        diagnostics:
          problem === undefined
            ? []
            : [{ messageText: problem, start: 0, length: 0, code: PROJECT_DIAGNOSTIC_CODE }],
        mappings: [
          [
            0,
            position(text, text.length),
            0,
            position(content, content.length),
            ATOM_SPAN,
            DEFINITION_FEATURES,
          ],
        ],
      };
    },

    closeProject(params) {
      projects.delete((params as { projectHandle: string }).projectHandle);
      return {};
    },
  };
}
