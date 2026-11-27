import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { loadFilesWithBaseDir, type FileLoadConfig } from "#/cli/services/file-loader";
import { getModuleExportName, type ASTNode } from "#/cli/services/workflow/ast-utils";
import { findAllJobs } from "#/cli/services/workflow/job-detector";
import { findAllWorkflows } from "#/cli/services/workflow/workflow-detector";
import { logger } from "#/cli/shared/logger";
import {
  createTsconfigLookupCache,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";

export interface StartTarget {
  kind: "job" | "workflow";
  name: string;
}

export interface StartModuleBindings {
  sourceFile: string;
  localBindings: Map<string, StartTarget>;
  exports: Map<string, StartTarget>;
}

export interface StartContext {
  modules: Map<string, StartModuleBindings>;
  /** Directory the workflow config's file patterns were resolved against (default: process.cwd()) */
  baseDir?: string | undefined;
  /**
   * Namespace of the config's only Auth service. Without it and `machineUserAuthNamespaces`, the
   * config has no Auth service, and a string-literal invoker stops the build.
   */
  authNamespace?: string | undefined;
  /** Name of the job function a job is started under (default: the job's own name) */
  jobFunctionName?: ((jobName: string) => string) | undefined;
  /**
   * Auth namespaces that define each machine user, for a config with several Auth services, whose
   * string-literal invokers are resolved by name.
   */
  machineUserAuthNamespaces?: ReadonlyMap<string, readonly string[]> | undefined;
  tsconfigCache?: TsconfigLookupCache | undefined;
  /**
   * Bindings of imported source files outside the workflow files, by file path; null for a file that
   * cannot be read or parsed, or that is a workflow file reached through another path.
   */
  unlistedModules?: Map<string, StartModuleBindings | null> | undefined;
}

type ParsedStartModule =
  | { bindings: StartModuleBindings; errors?: undefined }
  | { bindings?: undefined; errors: string[] };

/** Extensions of the source files that start calls and workflow files are read from. */
export const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"] as const;

/** Matches a path ending in one of SOURCE_EXTENSIONS. */
export const SOURCE_FILE_PATTERN = new RegExp(
  `\\.(${SOURCE_EXTENSIONS.map((extension) => extension.slice(1)).join("|")})$`,
);

/**
 * Normalize a source module path for start-call binding lookup.
 * @param filePath - Source file path or extensionless relative import path
 * @returns Absolute path without a JavaScript or TypeScript extension
 */
export function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath.replace(/[?#].*$/, "")).replace(SOURCE_FILE_PATTERN, "");
}

/**
 * Resolve symlinks in a path, falling back to the absolute path when it cannot be resolved.
 * @param filePath - Path to resolve
 * @returns Real path of the file, or its absolute path
 */
export function safeRealpath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync(resolved);
  } catch (e) {
    logger.debug(`realpathSync failed for ${resolved}: ${e instanceof Error ? e.message : e}`);
    return resolved;
  }
}

/**
 * Collect the workflows and jobs a parsed module defines and exports.
 * @param sourceFile - Source file path
 * @param program - Parsed program of the file
 * @param source - Source text of the file
 * @returns The module's start-call bindings
 */
export function createModuleBindings(
  sourceFile: string,
  program: ReturnType<typeof parseSync>["program"],
  source: string,
): StartModuleBindings {
  const localBindings = new Map<string, StartTarget>();
  const exports = new Map<string, StartTarget>();

  for (const workflow of findAllWorkflows(program, source)) {
    const target = { kind: "workflow", name: workflow.name } as const;
    if (workflow.exportName) localBindings.set(workflow.exportName, target);
    if (workflow.isDefaultExport) exports.set("default", target);
  }

  for (const job of findAllJobs(program, source)) {
    if (job.exportName) {
      localBindings.set(job.exportName, { kind: "job", name: job.name });
    }
  }

  for (const statement of program.body as unknown as ASTNode[]) {
    if (statement.type === "ExportDefaultDeclaration") {
      const declaration = statement.declaration as ASTNode | undefined;
      if (declaration?.type === "Identifier") {
        const target = localBindings.get(declaration.name as string);
        if (target) exports.set("default", target);
      }
      continue;
    }

    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration as ASTNode | undefined;
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations as ASTNode[]) {
        const id = declarator.id as ASTNode | undefined;
        if (id?.type !== "Identifier") continue;
        const localName = id.name as string;
        const target = localBindings.get(localName);
        if (target) exports.set(localName, target);
      }
    }

    if (statement.source) continue;
    for (const specifier of (statement.specifiers as ASTNode[] | undefined) ?? []) {
      const localName = getModuleExportName(specifier.local);
      const exportedName = getModuleExportName(specifier.exported);
      if (!localName || !exportedName) continue;
      const target = localBindings.get(localName);
      if (target) exports.set(exportedName, target);
    }
  }

  return { sourceFile, localBindings, exports } satisfies StartModuleBindings;
}

/**
 * Parse a source file and collect the workflows and jobs it defines and exports.
 * @param file - Source file path
 * @param source - Source text of the file
 * @returns The module's start-call bindings, or the parse error messages
 */
export function parseStartModule(file: string, source: string): ParsedStartModule {
  const { program, errors } = parseSync(file, source);
  if (errors.length > 0) return { errors: errors.map((e) => e.message) };
  return { bindings: createModuleBindings(file, program, source) };
}

export interface LoadedWorkflowSource {
  workflow: { name: string };
  sourceFile: string;
}

/**
 * Build start-call context from configured workflow source files.
 * @param workflowConfig - Workflow file loading configuration
 * @param authNamespace - Namespace of the config's only Auth service; undefined for a config with none or several
 * @param baseDir - Directory the workflow config's file patterns are resolved against (defaults to process.cwd())
 * @param loadedWorkflows - Default-exported workflows read by importing the workflow files, which also covers workflows the source text alone cannot identify
 * @param tsconfigCache - tsconfig lookup cache shared with the bundlers in this CLI run
 * @returns Module-local workflow and job binding metadata
 */
export async function buildStartContext(
  workflowConfig: FileLoadConfig | undefined,
  authNamespace?: string,
  baseDir = process.cwd(),
  loadedWorkflows: ReadonlyArray<LoadedWorkflowSource> = [],
  tsconfigCache: TsconfigLookupCache = createTsconfigLookupCache(),
): Promise<StartContext> {
  const modules = new Map<string, StartModuleBindings>();
  const unlistedModules = new Map<string, StartModuleBindings | null>();
  const loaded = workflowConfig
    ? loadFilesWithBaseDir(workflowConfig, baseDir)
    : { files: [], baseDir };

  for (const file of loaded.files) {
    try {
      const source = await fs.promises.readFile(file, "utf-8");
      const parsed = parseStartModule(file, source);
      if (parsed.errors) {
        logger.warn(`Failed to parse workflow file ${file}: ${parsed.errors.join("; ")}`, {
          mode: "stream",
        });
        continue;
      }
      modules.set(normalizeFilePath(file), parsed.bindings);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to process workflow file ${file}: ${errorMessage}`, {
        mode: "stream",
      });
    }
  }

  for (const { workflow, sourceFile } of loadedWorkflows) {
    modules
      .get(normalizeFilePath(sourceFile))
      ?.exports.set("default", { kind: "workflow", name: workflow.name });
  }

  return { modules, baseDir: loaded.baseDir, authNamespace, tsconfigCache, unlistedModules };
}

function sortedTargets(bindings: Map<string, StartTarget>) {
  return [...bindings]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([binding, target]) => [binding, target.kind, target.name]);
}

/**
 * Serialize start-call context to a deterministic cache input.
 * @param context - Start-call context to serialize
 * @returns Deterministic string, or an empty string when context is absent
 */
export function serializeStartContext(context: StartContext | undefined): string {
  if (!context) return "";
  const modules = [...context.modules]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([file, bindings]) => [
      file,
      sortedTargets(bindings.localBindings),
      sortedTargets(bindings.exports),
    ]);
  const machineUsers = context.machineUserAuthNamespaces
    ? JSON.stringify([...context.machineUserAuthNamespaces].toSorted())
    : "";
  return JSON.stringify(modules) + (context.authNamespace ?? "") + machineUsers;
}
