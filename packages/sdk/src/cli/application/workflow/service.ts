import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { styleText } from "node:util";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { WORKFLOW_JOB_BRAND } from "@/configure/services/workflow/job";
import {
  type Workflow,
  type WorkflowJob,
  WorkflowJobSchema,
  WorkflowSchema,
} from "@/parser/service/workflow";
import type { WorkflowServiceConfig } from "@/configure/services/workflow/types";

export interface CollectedJob {
  name: string;
  exportName: string;
  sourceFile: string;
  deps?: string[];
}

export class WorkflowService {
  private workflows: Record<string, Workflow> = {};
  private workflowSources: Array<{ workflow: Workflow; sourceFile: string }> =
    [];
  private collectedJobs: CollectedJob[] = [];
  private unusedJobs: string[] = [];
  private fileCount = 0;
  private loaded = false;

  constructor(public readonly config: WorkflowServiceConfig) {}

  /**
   * Load workflow files and collect all jobs in a single pass.
   * This method consolidates file loading to avoid duplicate reads.
   * Note: This method does not print logs. Call printLoadedWorkflows() to print logs.
   */
  async loadAndCollectJobs(): Promise<{
    workflows: Record<string, Workflow>;
    jobs: CollectedJob[];
  }> {
    if (this.loaded) {
      return { workflows: this.workflows, jobs: this.collectedJobs };
    }

    if (!this.config.files || this.config.files.length === 0) {
      this.loaded = true;
      return { workflows: this.workflows, jobs: this.collectedJobs };
    }

    const workflowFiles = loadFilesWithIgnores(this.config);
    this.fileCount = workflowFiles.length;

    // Maps for collecting data
    const allJobsMap = new Map<
      string,
      { name: string; exportName: string; sourceFile: string }
    >();

    // Load all files and collect jobs and workflows
    for (const workflowFile of workflowFiles) {
      const { jobs, workflow } = await this.loadFileContent(workflowFile);

      if (workflow) {
        this.workflowSources.push({ workflow, sourceFile: workflowFile });
        this.workflows[workflowFile] = workflow;
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
      }
    }

    // Trace dependencies from mainJob of each workflow
    const tracedJobs = new Map<string, WorkflowJob>();
    for (const { workflow } of this.workflowSources) {
      this.traceJobDependencies(workflow.mainJob, tracedJobs);
    }

    // Validate all traced jobs are exported
    const notExportedJobs: string[] = [];
    for (const jobName of tracedJobs.keys()) {
      if (!allJobsMap.has(jobName)) {
        notExportedJobs.push(jobName);
      }
    }

    if (notExportedJobs.length > 0) {
      throw new Error(
        `The following workflow jobs are used but not exported:\n` +
          notExportedJobs.map((name) => `  - "${name}"`).join("\n") +
          `\n\nAll workflow jobs must be named exports. Example:\n` +
          `  export const myJob = createWorkflowJob({ name: "my-job", ... });`,
      );
    }

    // Collect unused jobs for later warning
    this.unusedJobs = Array.from(allJobsMap.keys()).filter(
      (jobName) => !tracedJobs.has(jobName),
    );

    // Build collected jobs result
    for (const [jobName, job] of tracedJobs) {
      const exportedMetadata = allJobsMap.get(jobName);
      const depNames = job.deps?.map((dep) => dep.name);
      this.collectedJobs.push({ ...exportedMetadata!, deps: depNames });
    }

    this.loaded = true;
    return { workflows: this.workflows, jobs: this.collectedJobs };
  }

  /**
   * Print workflow loading logs.
   * Call this after loadAndCollectJobs() to print logs at the desired timing.
   */
  printLoadedWorkflows(): void {
    if (this.fileCount === 0) {
      return;
    }

    console.log("");
    console.log(
      "Found",
      styleText("cyanBright", this.fileCount.toString()),
      "workflow files",
    );

    for (const { workflow, sourceFile } of this.workflowSources) {
      const relativePath = path.relative(process.cwd(), sourceFile);
      console.log(
        "Workflow:",
        styleText("greenBright", `"${workflow.name}"`),
        "loaded from",
        styleText("cyan", relativePath),
      );
    }

    if (this.unusedJobs.length > 0) {
      console.warn(
        `⚠️  Warning: Unused workflow jobs found: ${this.unusedJobs.join(", ")}`,
      );
    }
  }

  /**
   * Load a single file and extract jobs and workflow
   */
  private async loadFileContent(filePath: string): Promise<{
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
      const moduleSpecifier = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
      const module = await import(moduleSpecifier);

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
        if (this.isWorkflowJob(exportValue)) {
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
      console.error(
        styleText("red", "Failed to load workflow from"),
        styleText("redBright", relativePath),
      );
      console.error(error);
      throw error;
    }

    return { jobs, workflow };
  }

  /**
   * Check if a value is a WorkflowJob by looking for the brand symbol
   */
  private isWorkflowJob(value: unknown): boolean {
    return (
      value != null &&
      typeof value === "object" &&
      WORKFLOW_JOB_BRAND in value &&
      (value as Record<symbol, unknown>)[WORKFLOW_JOB_BRAND] === true
    );
  }

  /**
   * Recursively trace all job dependencies
   */
  private traceJobDependencies(
    job: WorkflowJob,
    visited: Map<string, WorkflowJob>,
  ): void {
    if (visited.has(job.name)) {
      return;
    }
    visited.set(job.name, job);

    if (job.deps && Array.isArray(job.deps)) {
      for (const dep of job.deps) {
        this.traceJobDependencies(dep, visited);
      }
    }
  }

  /**
   * Get the collected jobs (must call loadAndCollectJobs first)
   */
  getCollectedJobs(): CollectedJob[] {
    return this.collectedJobs;
  }

  /**
   * Get loaded workflows (must call loadAndCollectJobs first)
   */
  getWorkflows(): Record<string, Workflow> {
    return this.workflows;
  }
}
