import { createHash } from "node:crypto";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { DEFAULT_CONFIG_PATH } from "#/cli/shared/args";
import { loadConfig } from "#/cli/shared/config-loader";
import { errorSummary } from "#/cli/shared/errors";
import { readPackageJson } from "#/cli/shared/package-json";
import { generateTypeDefinitionFromConfig } from "#/cli/shared/type-generator";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { collectLoadedFiles } from "./loaded-files";
import { initializeResult, type ContentMapperHandlers, type PositionEncoding } from "./protocol";

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
  error?: string;
  identity: string;
  watchedFiles: string[];
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

async function loadProject(
  tsconfigPath: string,
  previousWatchedFiles: string[] | undefined,
): Promise<Omit<Project, "identity"> & { configPath?: string }> {
  const searchFrom = path.dirname(tsconfigPath);
  const configPath = findUpSync(DEFAULT_CONFIG_PATH, { cwd: searchFrom });
  if (!configPath) {
    return {
      error: `No ${DEFAULT_CONFIG_PATH} found in ${searchFrom} or its parent directories`,
      watchedFiles: configCandidates(searchFrom),
    };
  }
  const cwd = process.cwd();
  try {
    process.chdir(path.dirname(configPath));
    beginUserModuleRun();
    const { outcome, files } = await collectLoadedFiles(async () => {
      const { config } = await loadConfig(configPath);
      return generateTypeDefinitionFromConfig(config);
    });
    const watchedFiles = [
      ...new Set([...configCandidates(searchFrom, path.dirname(configPath)), configPath, ...files]),
    ];
    if (outcome.status === "rejected") {
      return {
        configPath,
        error: errorSummary(outcome.reason),
        watchedFiles: [...new Set([...(previousWatchedFiles ?? []), ...watchedFiles])],
      };
    }
    return { configPath, registryTypes: outcome.value, watchedFiles };
  } finally {
    process.chdir(cwd);
  }
}

/**
 * Create the handlers of the content mapper that types `.tailor` files for
 * TypeScript from the project's `tailor.config.ts`.
 * @returns A handler for each method of the content mapper protocol
 */
export function createContentMapperHandlers(): ContentMapperHandlers {
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
      const loaded = await loadProject(configFileName, lastWatchedFiles.get(configFileName));
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
      const text =
        path.basename(fileName) === REGISTRY_FILE
          ? (project?.registryTypes ?? EMPTY_MODULE)
          : EMPTY_MODULE;
      return {
        extension: ".ts",
        text,
        diagnostics:
          project?.registryTypes === undefined
            ? [
                {
                  messageText: project?.error ?? PROJECT_NOT_OPENED,
                  start: 0,
                  length: 0,
                  code: PROJECT_DIAGNOSTIC_CODE,
                },
              ]
            : [],
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
