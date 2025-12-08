import * as fs from "node:fs";
import * as path from "node:path";
import { styleText } from "node:util";
import { parseSync } from "oxc-parser";
import {
  loadFilesWithIgnores,
  type FileLoadConfig,
} from "@/cli/application/file-loader";
import { findAllJobs, buildJobNameMap } from "./workflow/job-detector";
import { transformFunctionTriggers } from "./workflow/trigger-transformer";
import {
  findAllWorkflows,
  buildWorkflowNameMap,
} from "./workflow/workflow-detector";
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
}

/**
 * Normalize a file path by removing extension and resolving to absolute path
 */
function normalizeFilePath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath);
  return absolutePath.slice(0, -ext.length);
}

/**
 * Build trigger context from workflow configuration
 * Scans workflow files to collect workflow and job mappings
 */
export async function buildTriggerContext(
  workflowConfig: FileLoadConfig | undefined,
): Promise<TriggerContext> {
  const workflowNameMap = new Map<string, string>();
  const jobNameMap = new Map<string, string>();
  const workflowFileMap = new Map<string, string>();

  if (!workflowConfig) {
    return { workflowNameMap, jobNameMap, workflowFileMap };
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.warn(
        styleText(
          "yellow",
          `Warning: Failed to process workflow file ${file}: ${errorMessage}`,
        ),
      );
      continue;
    }
  }

  return { workflowNameMap, jobNameMap, workflowFileMap };
}

/**
 * Create a rolldown plugin for transforming trigger calls
 * Returns undefined if no trigger context is provided
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
          include: [/\.ts$/, /\.js$/],
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
        );
        return { code: transformed };
      },
    },
  };
}
