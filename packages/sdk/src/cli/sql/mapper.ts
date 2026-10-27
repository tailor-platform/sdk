import { createHash } from "node:crypto";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { loadConfig } from "#/cli/shared/config-loader";
import { readPackageJson } from "#/cli/shared/package-json";
import { beginUserModuleRun } from "#/cli/shared/user-modules";
import { analyzeSql, serializeSqlDefinitions, type SqlDefinitions } from "#/utils/sql/analyze";
import { renderSqlDeclaration } from "#/utils/sql/render";
import { loadSqlDefinitions } from "./load";
import { collectLoadedFiles } from "./loaded-files";
import type { JsonRpcHandler } from "./rpc";

type PositionEncoding = "utf-8" | "utf-16";

interface InitializeParams {
  positionEncodings?: PositionEncoding[];
  protocolVersion?: number;
}

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
  definitions?: SqlDefinitions;
  error?: string;
  identity: string;
  watchedFiles: string[];
}

const SQL_DIAGNOSTIC_CODE = 1;
const PROJECT_DIAGNOSTIC_CODE = 2;
const OPTION_DIAGNOSTIC_CODE = 3;
const ATOM_SPAN = 1;
const DEFINITION_FEATURES = (1 << 3) | (1 << 4);
const CONFIG_FILE = "tailor.config.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tableSourceFiles(project: Awaited<ReturnType<typeof loadSqlDefinitions>>): string[] {
  return project.services.flatMap((service) =>
    Object.values(service.typeSourceInfo).map(
      (source) => source.filePath ?? source.originalFilePath,
    ),
  );
}

async function loadProject(
  tsconfigPath: string,
  previousWatchedFiles: string[] | undefined,
): Promise<Omit<Project, "identity"> & { configPath?: string }> {
  const searchFrom = path.dirname(tsconfigPath);
  const configPath = findUpSync(CONFIG_FILE, { cwd: searchFrom });
  if (!configPath) {
    return {
      error: `No ${CONFIG_FILE} found in ${searchFrom} or its parent directories`,
      watchedFiles: [path.join(searchFrom, CONFIG_FILE)],
    };
  }
  const cwd = process.cwd();
  try {
    process.chdir(path.dirname(configPath));
    beginUserModuleRun();
    const { value, files } = await collectLoadedFiles(async () => {
      const { config, plugins } = await loadConfig(configPath);
      return loadSqlDefinitions(config, plugins);
    });
    const watchedFiles = [...new Set([configPath, ...tableSourceFiles(value), ...files])];
    return { configPath, definitions: value.definitions, watchedFiles };
  } catch (error) {
    return {
      configPath,
      error: errorMessage(error),
      watchedFiles: previousWatchedFiles ?? [configPath],
    };
  } finally {
    process.chdir(cwd);
  }
}

/**
 * Create the handlers of the content mapper that types `.sql` imports for
 * TypeScript from the TailorDB definitions of the project's `tailor.config.ts`.
 * @returns A handler for each method of the content mapper protocol
 */
export function createSqlMapperHandlers(): Record<string, JsonRpcHandler> {
  let encoding: PositionEncoding = "utf-16";
  const projects = new Map<string, Project>();
  const lastWatchedFiles = new Map<string, string[]>();
  const position = (content: string, offset: number): number =>
    encoding === "utf-16" ? offset : Buffer.byteLength(content.slice(0, offset));

  return {
    initialize(params) {
      const { positionEncodings, protocolVersion } = (params ?? {}) as InitializeParams;
      encoding = positionEncodings && !positionEncodings.includes("utf-16") ? "utf-8" : "utf-16";
      return {
        ...(protocolVersion !== undefined && { protocolVersion }),
        positionEncoding: encoding,
        diagnosticSource: "tailordb-sql",
      };
    },

    async openProject(params) {
      const { configFileName, projectHandle, options } = params as OpenProjectParams;
      const loaded = await loadProject(configFileName, lastWatchedFiles.get(configFileName));
      if (loaded.definitions) lastWatchedFiles.set(configFileName, loaded.watchedFiles);
      const { version } = await readPackageJson();
      const identity = createHash("sha256")
        .update(
          JSON.stringify([
            version,
            loaded.configPath ?? null,
            loaded.error ?? null,
            loaded.definitions ? serializeSqlDefinitions(loaded.definitions) : null,
          ]),
        )
        .digest("hex");
      projects.set(projectHandle, { ...loaded, identity });
      return {
        configIdentity: identity,
        watchedFiles: loaded.watchedFiles,
        optionDiagnostics: Object.keys(options ?? {}).map((key) => ({
          path: [key],
          messageText: `@tailor-platform/sdk's content mapper takes no options; it reads ${CONFIG_FILE}`,
          code: OPTION_DIAGNOSTIC_CODE,
        })),
      };
    },

    transform(params) {
      const { content, projectHandle } = params as TransformParams;
      const project = projects.get(projectHandle);
      const result = project?.definitions
        ? analyzeSql(content, project.definitions)
        : {
            diagnostics: [
              {
                message:
                  project?.error ?? "The project was not opened; restart the TypeScript server",
                start: 0,
                length: 0,
              },
            ],
          };
      const text = renderSqlDeclaration(result.analysis);
      const code = project?.definitions ? SQL_DIAGNOSTIC_CODE : PROJECT_DIAGNOSTIC_CODE;
      return {
        extension: ".ts",
        text,
        diagnostics: result.diagnostics.map((diagnostic) => {
          const start = position(content, diagnostic.start);
          return {
            messageText: diagnostic.message,
            start,
            length: position(content, diagnostic.start + diagnostic.length) - start,
            code,
          };
        }),
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
