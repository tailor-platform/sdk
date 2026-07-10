import * as fs from "node:fs";
import { getTsconfig } from "get-tsconfig";
import { parseSync } from "oxc-parser";
import { loadFilesWithIgnores, type FileLoadConfig } from "#/cli/services/file-loader";
import { getModuleExportName, type ASTNode } from "#/cli/services/workflow/ast-utils";
import { findAllJobs } from "#/cli/services/workflow/job-detector";
import { transformFunctionTriggers } from "#/cli/services/workflow/trigger-transformer";
import { findAllWorkflows } from "#/cli/services/workflow/workflow-detector";
import { logger } from "#/cli/shared/logger";
import {
  type TriggerContext,
  type TriggerModuleBindings,
  type TriggerModuleResolution,
  type TriggerTarget,
} from "./trigger-context.types";
import { normalizeTriggerModulePath } from "./trigger-path";
import type { Plugin } from "rolldown";

export type {
  TriggerContext,
  TriggerModuleBindings,
  TriggerModuleResolution,
  TriggerTarget,
} from "./trigger-context.types";

/**
 * Normalize a file path by removing extension and resolving to absolute path
 * @param filePath - File path to normalize
 * @returns Normalized absolute path without extension
 */
export function normalizeFilePath(filePath: string): string {
  return normalizeTriggerModulePath(filePath);
}

function createModuleBindings(program: ReturnType<typeof parseSync>["program"], source: string) {
  const localBindings = new Map<string, TriggerTarget>();
  const exports = new Map<string, TriggerTarget>();

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

  return { localBindings, exports } satisfies TriggerModuleBindings;
}

function loadModuleResolution(searchPath: string): TriggerModuleResolution | undefined {
  try {
    const tsconfig = getTsconfig(searchPath);
    if (!tsconfig) return undefined;
    const compilerOptions = tsconfig.config.compilerOptions;
    if (!compilerOptions?.baseUrl && !compilerOptions?.paths) return undefined;
    return tsconfig;
  } catch {
    return undefined;
  }
}

/**
 * Build trigger context from workflow configuration
 * Scans workflow files to collect workflow and job mappings
 * @param workflowConfig - Workflow file loading configuration
 * @param authNamespace - Auth service namespace (optional, used for string-literal authInvoker expansion)
 * @returns Trigger context built from workflow sources
 */
export async function buildTriggerContext(
  workflowConfig: FileLoadConfig | undefined,
  authNamespace?: string,
): Promise<TriggerContext> {
  const modules = new Map<string, TriggerModuleBindings>();

  if (!workflowConfig) {
    return { modules, authNamespace };
  }

  const workflowFiles = loadFilesWithIgnores(workflowConfig);

  for (const file of workflowFiles) {
    try {
      const source = await fs.promises.readFile(file, "utf-8");
      const { program } = parseSync("input.ts", source);
      const modulePath = normalizeFilePath(file);
      modules.set(modulePath, createModuleBindings(program, source));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to process workflow file ${file}: ${errorMessage}`, {
        mode: "stream",
      });
      continue;
    }
  }

  return {
    modules,
    moduleResolution: loadModuleResolution(process.cwd()),
    authNamespace,
  };
}

function sortedTargets(bindings: Map<string, TriggerTarget>) {
  return [...bindings]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([binding, target]) => [binding, target.kind, target.name]);
}

function sortedModuleResolution(resolution: TriggerModuleResolution | undefined) {
  if (!resolution) return null;
  const compilerOptions = resolution.config.compilerOptions;
  const symbolMetadata = Object.getOwnPropertySymbols(compilerOptions ?? {})
    .map((symbol) => [
      symbol.description ?? symbol.toString(),
      Reflect.get(compilerOptions ?? {}, symbol),
    ])
    .toSorted(([a], [b]) => String(a).localeCompare(String(b)));
  return [resolution.path, resolution.config, symbolMetadata];
}

/**
 * Serialize trigger context to a deterministic string for cache hashing.
 * Returns an empty string if no context is provided.
 * @param ctx - Trigger context to serialize
 * @returns Deterministic string representation
 */
export function serializeTriggerContext(ctx: TriggerContext | undefined): string {
  if (!ctx) return "";
  const modules = [...ctx.modules]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([file, bindings]) => [
      file,
      sortedTargets(bindings.localBindings),
      sortedTargets(bindings.exports),
    ]);
  return (
    JSON.stringify(modules) +
    JSON.stringify(sortedModuleResolution(ctx.moduleResolution)) +
    (ctx.authNamespace ?? "")
  );
}

/**
 * Create a rolldown plugin for transforming trigger calls
 * Returns undefined if no trigger context is provided
 * @param triggerContext - Trigger context to use for transformations
 * @returns Rolldown plugin or undefined when no context
 */
export function createTriggerTransformPlugin(
  triggerContext: TriggerContext | undefined,
): Plugin | undefined {
  if (!triggerContext) {
    return undefined;
  }

  return {
    name: "trigger-transform",
    transform: {
      filter: {
        id: {
          include: [/\.(ts|mts|cts|js|mjs|cjs)$/],
        },
      },
      handler(code, id) {
        // Only transform source files that contain trigger calls
        if (!code.includes(".trigger(")) {
          return null;
        }
        const transformed = transformFunctionTriggers(code, triggerContext, id);
        return { code: transformed };
      },
    },
  };
}
