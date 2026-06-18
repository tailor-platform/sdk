import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { loadFilesWithIgnores, type FileLoadConfig } from "@/cli/services/file-loader";
import { findAllJobs, buildJobNameMap } from "@/cli/services/workflow/job-detector";
import { transformFunctionTriggers } from "@/cli/services/workflow/trigger-transformer";
import { findAllWorkflows, buildWorkflowNameMap } from "@/cli/services/workflow/workflow-detector";
import { logger } from "@/cli/shared/logger";
import type { Plugin } from "rolldown";

/**
 * Context for trigger transformation
 * Maps variable names to workflow/job names
 */
export interface TriggerContext {
  workflowNameMap: Map<string, string>;
  jobNameMap: Map<string, string>;
  /** Maps file path (without extension) to workflow name for default exports */
  workflowFileMap: Map<string, string>;
  /**
   * Auth service namespace used to expand a string-literal `invoker`
   * (e.g. `"kiosk"`) to the `{ namespace, machineUserName }` form expected by
   * the runtime. Undefined when no Auth service is configured.
   */
  authNamespace?: string;
}

/**
 * Normalize a file path by removing extension and resolving to absolute path
 * @param filePath - File path to normalize
 * @returns Normalized absolute path without extension
 */
export function normalizeFilePath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath);
  return absolutePath.slice(0, -ext.length);
}

/**
 * Build trigger context from workflow configuration
 * Scans workflow files to collect workflow and job mappings
 * @param workflowConfig - Workflow file loading configuration
 * @param authNamespace - Auth service namespace (optional, used for string-literal invoker expansion)
 * @returns Trigger context built from workflow sources
 */
export async function buildTriggerContext(
  workflowConfig: FileLoadConfig | undefined,
  authNamespace?: string,
): Promise<TriggerContext> {
  const workflowNameMap = new Map<string, string>();
  const jobNameMap = new Map<string, string>();
  const workflowFileMap = new Map<string, string>();

  if (!workflowConfig) {
    return {
      workflowNameMap,
      jobNameMap,
      workflowFileMap,
      authNamespace,
    };
  }

  const workflowFiles = loadFilesWithIgnores(workflowConfig);

  for (const file of workflowFiles) {
    try {
      const source = await fs.promises.readFile(file, "utf-8");
      const { program } = parseSync("input.ts", source);

      // Detect workflows
      const workflows = findAllWorkflows(program, source);
      const workflowMap = buildWorkflowNameMap(workflows);
      for (const [exportName, workflowName] of workflowMap) {
        workflowNameMap.set(exportName, workflowName);
      }

      // Also track default exported workflows by file path
      for (const workflow of workflows) {
        if (workflow.isDefaultExport) {
          const normalizedPath = normalizeFilePath(file);
          workflowFileMap.set(normalizedPath, workflow.name);
        }
      }

      // Detect jobs
      const jobs = findAllJobs(program, source);
      const jobMap = buildJobNameMap(jobs);
      for (const [exportName, jobName] of jobMap) {
        jobNameMap.set(exportName, jobName);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to process workflow file ${file}: ${errorMessage}`, {
        mode: "stream",
      });
      continue;
    }
  }

  return {
    workflowNameMap,
    jobNameMap,
    workflowFileMap,
    authNamespace,
  };
}

function sortedMapToJson(m: Map<string, string>): string {
  return JSON.stringify([...m.entries()].toSorted(([a], [b]) => a.localeCompare(b)));
}

/**
 * Serialize trigger context to a deterministic string for cache hashing.
 * Returns an empty string if no context is provided.
 * @param ctx - Trigger context to serialize
 * @returns Deterministic string representation
 */
export function serializeTriggerContext(ctx: TriggerContext | undefined): string {
  if (!ctx) return "";
  return (
    sortedMapToJson(ctx.workflowNameMap) +
    sortedMapToJson(ctx.jobNameMap) +
    sortedMapToJson(ctx.workflowFileMap) +
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
        const transformed = transformFunctionTriggers(
          code,
          triggerContext.workflowNameMap,
          triggerContext.jobNameMap,
          triggerContext.workflowFileMap,
          id,
          triggerContext.authNamespace,
        );
        return { code: transformed };
      },
    },
  };
}
