import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { RESOLVERS_FILE, TAILORDB_FILE } from "#/cli/resolver-client/module";
import { listResolvers, renderResolverDeclarations } from "#/cli/resolver-client/resolvers";
import {
  listTailorDBTypes,
  renderTailorDBDeclarations,
} from "#/cli/resolver-client/tailordb-types";
import { DEFAULT_CONFIG_PATH } from "#/cli/shared/args";
import { loadConfig, type LoadedConfig } from "#/cli/shared/config-loader";
import { errorSummary } from "#/cli/shared/errors";
import { readPackageJson } from "#/cli/shared/package-json";
import { loadConfigNamespaces } from "#/cli/shared/tailordb-namespaces";
import { generateTypeDefinitionFromConfig } from "#/cli/shared/type-generator";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { collectLoadedFiles } from "./loaded-files";
import { initializeResult, type ContentMapperHandlers, type PositionEncoding } from "./protocol";
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

/** The declarations of `resolvers.tailor` and `tailordb.tailor`. */
export interface ClientTypes {
  resolvers: string;
  tailordb: string;
}

interface ClientSource {
  clientTypes?: ClientTypes;
  clientError?: string;
  error?: string;
}

interface Project extends ClientSource {
  registryTypes?: string;
  configPath?: string;
  identity: string;
  watchedFiles: string[];
  explicitConfig: boolean;
  nearby: Map<string, Promise<Evaluation>>;
}

const REGISTRY_FILE = "registry.tailor";
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

export interface Evaluation extends ClientSource {
  registryTypes?: string;
  files: string[];
}

export type EvaluateConfig = (configPath: string) => Promise<Evaluation>;

async function loadClientTypes(
  config: LoadedConfig,
  plugins: Plugin[],
): Promise<{ types: ClientTypes; files: string[] }> {
  const { application, namespaces } = await loadConfigNamespaces(config, plugins);
  const resolvers = await listResolvers(application);
  const tables = listTailorDBTypes(namespaces);
  return {
    types: {
      resolvers: renderResolverDeclarations(resolvers),
      tailordb: renderTailorDBDeclarations(tables),
    },
    files: [...resolvers.map(({ file }) => file), ...tables.map(({ file }) => file)],
  };
}

/**
 * Evaluate `tailor.config.ts` in this process and collect the project files it imports.
 * A resolver or table definition that fails to load does not stop the registry types.
 * @param configPath - Path of `tailor.config.ts`
 * @returns The registry types and the declarations for `resolvers.tailor` and `tailordb.tailor`, or the errors that stopped them, and the files imported
 */
export async function evaluateConfigInProcess(configPath: string): Promise<Evaluation> {
  const cwd = process.cwd();
  try {
    process.chdir(path.dirname(configPath));
    beginUserModuleRun();
    const registry = await collectLoadedFiles(async () => {
      const { config, plugins } = await loadConfig(configPath);
      return { config, plugins, registryTypes: generateTypeDefinitionFromConfig(config) };
    });
    if (registry.outcome.status === "rejected") {
      return { error: errorSummary(registry.outcome.reason), files: registry.files };
    }
    const { config, plugins, registryTypes } = registry.outcome.value;
    const client = await collectLoadedFiles(() => loadClientTypes(config, plugins));
    const files = [...new Set([...registry.files, ...client.files])];
    if (client.outcome.status === "rejected") {
      return { registryTypes, clientError: errorSummary(client.outcome.reason), files };
    }
    return {
      registryTypes,
      clientTypes: client.outcome.value.types,
      files: [...new Set([...files, ...client.outcome.value.files])],
    };
  } finally {
    process.chdir(cwd);
  }
}

async function loadProject(
  tsconfigPath: string,
  configOption: string | undefined,
  previousWatchedFiles: string[] | undefined,
  evaluate: EvaluateConfig,
): Promise<Omit<Project, "identity" | "explicitConfig" | "nearby">> {
  const searchFrom = path.dirname(tsconfigPath);
  const explicit = configOption === undefined ? undefined : path.resolve(searchFrom, configOption);
  if (explicit !== undefined && !fs.existsSync(explicit)) {
    return { error: `No config found at ${explicit}`, watchedFiles: [explicit] };
  }
  const configPath = explicit ?? findUpSync(DEFAULT_CONFIG_PATH, { cwd: searchFrom });
  if (!configPath) {
    return {
      error: `No ${DEFAULT_CONFIG_PATH} found in ${searchFrom} or its parent directories`,
      watchedFiles: configCandidates(searchFrom),
    };
  }
  const { files, ...evaluation } = await evaluate(configPath);
  const candidates =
    explicit === undefined ? configCandidates(searchFrom, path.dirname(configPath)) : [];
  const watchedFiles = [...new Set([...candidates, configPath, ...files])];
  if (evaluation.registryTypes === undefined) {
    return {
      configPath,
      ...evaluation,
      watchedFiles: [...new Set([...(previousWatchedFiles ?? []), ...watchedFiles])],
    };
  }
  return { configPath, ...evaluation, watchedFiles };
}

/**
 * Create the handlers of the content mapper that types `.tailor` files for
 * TypeScript from the project's `tailor.config.ts`.
 * @param evaluate - Evaluates the config; defaults to evaluating it in this process
 * @returns A handler for each method of the content mapper protocol
 */
export function createContentMapperHandlers(
  evaluate: EvaluateConfig = evaluateConfigInProcess,
): ContentMapperHandlers {
  let encoding: PositionEncoding = "utf-16";
  const projects = new Map<string, Project>();
  const lastWatchedFiles = new Map<string, string[]>();
  const position = (content: string, offset: number): number =>
    encoding === "utf-16" ? offset : Buffer.byteLength(content.slice(0, offset));

  async function clientSourceFor(fileName: string, project: Project): Promise<ClientSource> {
    if (!project.explicitConfig) {
      const nearest = findUpSync(DEFAULT_CONFIG_PATH, { cwd: path.dirname(fileName) });
      if (nearest && path.resolve(nearest) !== project.configPath) {
        let loading = project.nearby.get(nearest);
        if (!loading) {
          loading = evaluate(nearest);
          project.nearby.set(nearest, loading);
        }
        return loading;
      }
    }
    return project;
  }

  async function mappedFile(
    fileName: string,
    project: Project | undefined,
  ): Promise<{ text: string; problem?: string }> {
    const name = path.basename(fileName);
    if (name === RESOLVERS_FILE || name === TAILORDB_FILE) {
      const source = project
        ? await clientSourceFor(fileName, project)
        : { error: PROJECT_NOT_OPENED };
      const types =
        name === RESOLVERS_FILE ? source.clientTypes?.resolvers : source.clientTypes?.tailordb;
      return types === undefined
        ? { text: EMPTY_MODULE, problem: source.error ?? source.clientError ?? PROJECT_NOT_OPENED }
        : { text: types };
    }
    const registryTypes = project?.registryTypes;
    return {
      text: name === REGISTRY_FILE ? (registryTypes ?? EMPTY_MODULE) : EMPTY_MODULE,
      ...(registryTypes === undefined && {
        problem: project?.error ?? PROJECT_NOT_OPENED,
      }),
    };
  }

  return {
    initialize(params) {
      const result = initializeResult(params);
      encoding = result.positionEncoding;
      return result;
    },

    async openProject(params) {
      const { configFileName, projectHandle, options } = params as OpenProjectParams;
      const { config: configOption, ...unknownOptions } = options ?? {};
      const configFile = typeof configOption === "string" ? configOption : undefined;
      const loaded = await loadProject(
        configFileName,
        configFile,
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
            loaded.clientTypes ?? null,
            loaded.clientError ?? null,
          ]),
        )
        .digest("hex");
      projects.set(projectHandle, {
        ...loaded,
        identity,
        explicitConfig: configFile !== undefined,
        nearby: new Map(),
      });
      return {
        configIdentity: identity,
        watchedFiles: loaded.watchedFiles,
        optionDiagnostics: [
          ...Object.keys(unknownOptions).map((key) => ({
            path: [key],
            messageText: `@tailor-platform/sdk's content mapper takes only the config option, the path of ${DEFAULT_CONFIG_PATH}`,
            code: OPTION_DIAGNOSTIC_CODE,
          })),
          ...(configOption !== undefined && configFile === undefined
            ? [
                {
                  path: ["config"],
                  messageText: `config must be the path of ${DEFAULT_CONFIG_PATH}`,
                  code: OPTION_DIAGNOSTIC_CODE,
                },
              ]
            : []),
        ],
      };
    },

    async transform(params) {
      const { fileName, content, projectHandle } = params as TransformParams;
      const { text, problem } = await mappedFile(fileName, projects.get(projectHandle));
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
