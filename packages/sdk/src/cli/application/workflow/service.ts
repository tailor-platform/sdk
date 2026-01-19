import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { logger, styles } from "@/cli/utils/logger";
import { WORKFLOW_JOB_BRAND } from "@/configure/services/workflow/job";
import { type Workflow, WorkflowJobSchema, WorkflowSchema } from "@/parser/service/workflow";
import type { WorkflowServiceConfig } from "@/configure/services/workflow/types";

export interface CollectedJob {
  name: string;
  exportName: string;
  sourceFile: string;
}

export interface WorkflowLoadResult {
  workflows: Record<string, Workflow>;
  workflowSources: Array<{ workflow: Workflow; sourceFile: string }>;
  jobs: CollectedJob[];
  fileCount: number;
}

/**
 * Load workflow files and collect all jobs in a single pass.
 * Dependencies are detected at bundle time via AST analysis.
 * @param {WorkflowServiceConfig} config - Workflow service configuration
 * @returns {Promise<WorkflowLoadResult>} Loaded workflows and collected jobs
 */
export async function loadAndCollectJobs(
  config: WorkflowServiceConfig,
): Promise<WorkflowLoadResult> {
  const workflows: Record<string, Workflow> = {};
  const workflowSources: Array<{ workflow: Workflow; sourceFile: string }> = [];
  const collectedJobs: CollectedJob[] = [];

  if (!config.files || config.files.length === 0) {
    return {
      workflows,
      workflowSources,
      jobs: collectedJobs,
      fileCount: 0,
    };
  }

  const workflowFiles = loadFilesWithIgnores(config);
  const fileCount = workflowFiles.length;

  // Maps for collecting data
  const allJobsMap = new Map<string, { name: string; exportName: string; sourceFile: string }>();

  // Load all files in parallel and collect jobs and workflows
  const loadResults = await Promise.all(
    workflowFiles.map(async (workflowFile) => {
      const { jobs, workflow } = await loadFileContent(workflowFile);
      return { workflowFile, jobs, workflow };
    }),
  );

  for (const { workflowFile, jobs, workflow } of loadResults) {
    if (workflow) {
      workflowSources.push({ workflow, sourceFile: workflowFile });
      workflows[workflowFile] = workflow;
    }

    for (const job of jobs) {
      const existing = allJobsMap.get(job.name);
      if (existing) {
        throw new Error(
          `Duplicate job name "${job.name}" found:\n` +
            `  - ${existing.sourceFile} (export: ${existing.exportName})\n` +
            `  - ${job.sourceFile} (export: ${job.exportName})\n` +
            `Each job must have a unique name.`,
        );
      }
      allJobsMap.set(job.name, job);
      collectedJobs.push(job);
    }
  }

  return {
    workflows,
    workflowSources,
    jobs: collectedJobs,
    fileCount,
  };
}

/**
 * Print workflow loading logs.
 * @param {WorkflowLoadResult} result - Workflow load result to print
 */
export function printLoadedWorkflows(result: WorkflowLoadResult): void {
  if (result.fileCount === 0) {
    return;
  }

  logger.newline();
  logger.log(`Found ${styles.highlight(result.fileCount.toString())} workflow files`);

  for (const { workflow, sourceFile } of result.workflowSources) {
    const relativePath = path.relative(process.cwd(), sourceFile);
    logger.log(
      `Workflow: ${styles.successBright(`"${workflow.name}"`)} loaded from ${styles.path(relativePath)}`,
    );
  }
}

/**
 * Load a single file and extract jobs and workflow
 * @param {string} filePath - Path to the workflow file
 * @returns {Promise<{ jobs: Array<{ name: string; exportName: string; sourceFile: string }>; workflow: Workflow | null }>} Extracted jobs and workflow
 */
async function loadFileContent(filePath: string): Promise<{
  jobs: Array<{ name: string; exportName: string; sourceFile: string }>;
  workflow: Workflow | null;
}> {
  const jobs: Array<{
    name: string;
    exportName: string;
    sourceFile: string;
  }> = [];
  let workflow: Workflow | null = null;

  try {
    const module = await import(pathToFileURL(filePath).href);

    for (const [exportName, exportValue] of Object.entries(module)) {
      // Check if it's a workflow (default export)
      if (exportName === "default") {
        const workflowResult = WorkflowSchema.safeParse(exportValue);
        if (workflowResult.success) {
          workflow = workflowResult.data;
        }
        continue;
      }

      // Check if it's a workflow job using Symbol brand
      if (isWorkflowJob(exportValue)) {
        const jobResult = WorkflowJobSchema.safeParse(exportValue);
        if (jobResult.success) {
          jobs.push({
            name: jobResult.data.name,
            exportName,
            sourceFile: filePath,
          });
        }
      }
    }
  } catch (error) {
    const relativePath = path.relative(process.cwd(), filePath);
    logger.error(
      `${styles.error("Failed to load workflow from")} ${styles.errorBright(relativePath)}`,
    );
    logger.error(String(error));
    throw error;
  }

  return { jobs, workflow };
}

/**
 * Check if a value is a WorkflowJob by looking for the brand symbol
 * @param {unknown} value - Value to check
 * @returns {boolean} True if the value is a branded WorkflowJob
 */
function isWorkflowJob(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    WORKFLOW_JOB_BRAND in value &&
    (value as Record<symbol, unknown>)[WORKFLOW_JOB_BRAND] === true
  );
}
