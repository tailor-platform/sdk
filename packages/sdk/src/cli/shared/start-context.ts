import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { loadFilesWithIgnores, type FileLoadConfig } from "#/cli/services/file-loader";
import { getModuleExportName, type ASTNode } from "#/cli/services/workflow/ast-utils";
import { findAllJobs } from "#/cli/services/workflow/job-detector";
import { findAllWorkflows } from "#/cli/services/workflow/workflow-detector";
import { logger } from "#/cli/shared/logger";

export interface StartTarget {
  kind: "job" | "workflow";
  name: string;
}

export interface StartModuleBindings {
  localBindings: Map<string, StartTarget>;
  exports: Map<string, StartTarget>;
}

export interface StartContext {
  modules: Map<string, StartModuleBindings>;
  authNamespace?: string;
}

/**
 * Normalize a source module path for start-call binding lookup.
 * @param filePath - Source file path or extensionless relative import path
 * @returns Absolute path without a JavaScript or TypeScript extension
 */
export function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath.replace(/[?#].*$/, "")).replace(/\.(ts|mts|cts|js|mjs|cjs)$/, "");
}

function createModuleBindings(program: ReturnType<typeof parseSync>["program"], source: string) {
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

  return { localBindings, exports } satisfies StartModuleBindings;
}

/**
 * Build start-call context from configured workflow source files.
 * @param workflowConfig - Workflow file loading configuration
 * @param authNamespace - Auth service namespace (optional, used for string-literal invoker expansion)
 * @param baseDir - Directory the workflow config's file patterns are resolved against (defaults to process.cwd())
 * @returns Module-local workflow and job binding metadata
 */
export async function buildStartContext(
  workflowConfig: FileLoadConfig | undefined,
  authNamespace?: string,
  baseDir = process.cwd(),
): Promise<StartContext> {
  const modules = new Map<string, StartModuleBindings>();
  if (!workflowConfig) return { modules, authNamespace };

  for (const file of loadFilesWithIgnores(workflowConfig, baseDir)) {
    try {
      const source = await fs.promises.readFile(file, "utf-8");
      const { program } = parseSync("input.ts", source);
      modules.set(normalizeFilePath(file), createModuleBindings(program, source));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to process workflow file ${file}: ${errorMessage}`, {
        mode: "stream",
      });
    }
  }

  return { modules, authNamespace };
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
  return JSON.stringify(modules) + (context.authNamespace ?? "");
}
