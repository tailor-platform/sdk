import { pathToFileURL } from "node:url";
import * as path from "pathe";
import { loadFilesWithIgnores } from "@/cli/services/file-loader";
import { logger, styles } from "@/cli/shared/logger";
import { WorkflowJobSchema, WorkflowSchema } from "@/parser/service/workflow";
import { isSdkBranded } from "@/utils/brand";
import type { WorkflowServiceConfig } from "@/types/app-config";
import type { Workflow } from "@/types/workflow.generated";

export interface CollectedJob {
  name: string;
  exportName: string;
  sourceFile: string;
}

interface WorkflowLoadResult {
  workflows: Record<string, Workflow>;
  workflowSources: Array<{ workflow: Workflow; sourceFile: string }>;
  jobs: CollectedJob[];
  fileCount: number;
}

export type WorkflowService = {
  readonly config: WorkflowServiceConfig;
  readonly workflows: Record<string, Workflow>;
  readonly workflowSources: ReadonlyArray<{ workflow: Workflow; sourceFile: string }>;
  readonly jobs: CollectedJob[];
  readonly fileCount: number;
  loadWorkflows: () => Promise<void>;
  printLoadedWorkflows: () => void;
};

/**
 * Parameters for creating a WorkflowService
 */
export interface CreateWorkflowServiceParams {
  /** The workflow service configuration */
  config: WorkflowServiceConfig;
}

/**
 * Creates a new WorkflowService instance.
 * @param params - Parameters for creating the service
 * @returns A new WorkflowService instance
 */
export function createWorkflowService(params: CreateWorkflowServiceParams): WorkflowService {
  const { config } = params;
  let workflows: Record<string, Workflow> = {};
  let workflowSources: Array<{ workflow: Workflow; sourceFile: string }> = [];
  let jobs: CollectedJob[] = [];
  let fileCount = 0;
  let loaded = false;

  return {
    config,
    get workflows() {
      return workflows;
    },
    get workflowSources() {
      return workflowSources;
    },
    get jobs() {
      return jobs;
    },
    get fileCount() {
      return fileCount;
    },
    loadWorkflows: async () => {
      if (loaded) {
        return;
      }
      const result = await loadAndCollectJobs(config);
      workflows = result.workflows;
      workflowSources = result.workflowSources;
      jobs = result.jobs;
      fileCount = result.fileCount;
      loaded = true;
    },
    printLoadedWorkflows: () => {
      if (fileCount === 0) {
        return;
      }
      logger.newline();
      logger.log(`Found ${styles.highlight(fileCount.toString())} workflow files`);
      for (const { workflow, sourceFile } of workflowSources) {
        const relativePath = path.relative(process.cwd(), sourceFile);
        logger.log(
          `Workflow: ${styles.successBright(`"${workflow.name}"`)} loaded from ${styles.path(relativePath)}`,
        );
      }
    },
  };
}

/**
 * Load workflow files and collect all jobs in a single pass.
 * Dependencies are detected at bundle time via AST analysis.
 * @param config - Workflow service configuration
 * @returns Loaded workflows and collected jobs
 */
async function loadAndCollectJobs(config: WorkflowServiceConfig): Promise<WorkflowLoadResult> {
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
 * Load a single file and extract jobs and workflow
 * @param filePath - Path to the workflow file
 * @returns Extracted jobs and workflow
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
        } else if (isSdkBranded(exportValue, ["workflow", "workflow-job"])) {
          throw workflowResult.error;
        }
        continue;
      }

      const jobResult = WorkflowJobSchema.safeParse(exportValue);
      if (jobResult.success) {
        jobs.push({
          name: jobResult.data.name,
          exportName,
          sourceFile: filePath,
        });
      } else if (isSdkBranded(exportValue, ["workflow", "workflow-job"])) {
        throw jobResult.error;
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
