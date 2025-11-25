import { pathToFileURL } from "node:url";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
import { type ILoader } from "@/cli/bundler";
import { WORKFLOW_JOB_BRAND } from "@/configure/services/workflow/job";
import {
  WorkflowJobSchema,
  WorkflowSchema,
  type WorkflowJob,
  type Workflow,
} from "@/parser/service/workflow";
import type { WorkflowServiceConfig } from "@/configure/services/workflow/types";

/**
 * Check if a value is a WorkflowJob by looking for the brand symbol.
 * This enables reliable detection regardless of how the job was created
 * (variable reassignment, destructuring, higher-order functions, etc.)
 */
function isWorkflowJob(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    WORKFLOW_JOB_BRAND in value &&
    (value as Record<symbol, unknown>)[WORKFLOW_JOB_BRAND] === true
  );
}

export class WorkflowJobLoader implements ILoader<WorkflowJob> {
  constructor(private exportName?: string) {}

  /**
   * Job metadata returned from collectAllJobs
   * - If exportName is defined: job is exported and can be imported directly
   * - If exportName is undefined: job is accessed via workflow.mainJob
   */
  static readonly JobMetadata: unique symbol = Symbol("JobMetadata");

  /**
   * Collect all jobs from workflow configuration
   * This method collects all jobs from files matching the glob pattern,
   * then traces dependencies from mainJob to validate and filter
   */
  static async collectAllJobs(
    config: WorkflowServiceConfig,
  ): Promise<Array<{ name: string; exportName?: string; sourceFile: string }>> {
    if (!config.files || config.files.length === 0) {
      return [];
    }

    // Step 1: Collect all job files matching the glob pattern
    const allJobFiles = loadFilesWithIgnores({
      files: config.files,
      ignores: config.ignores,
    });

    // Step 2: Extract job metadata from all files using dynamic import
    const allJobsMap = new Map<
      string,
      { name: string; exportName: string; sourceFile: string }
    >();
    const workflowsWithSource: Array<{
      workflow: Workflow;
      sourceFile: string;
    }> = [];

    for (const jobFile of allJobFiles) {
      const { jobs, workflow } = await this.loadJobsFromFile(jobFile);

      // Collect workflow with its source file
      if (workflow) {
        workflowsWithSource.push({ workflow, sourceFile: jobFile });
      }

      // Collect exported jobs
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

    // Step 3: Trace dependencies from mainJob of each workflow
    // Collect both job names and job objects (for jobs not exported but used via deps)
    const tracedJobs = new Map<string, WorkflowJob>();

    for (const { workflow } of workflowsWithSource) {
      this.traceJobDependenciesWithObjects(workflow.mainJob, tracedJobs);
    }

    // Step 4: Build mainJob -> workflow source mapping
    // This allows us to access non-exported mainJobs via workflow.mainJob
    const mainJobSourceMap = new Map<string, string>();
    for (const { workflow, sourceFile } of workflowsWithSource) {
      mainJobSourceMap.set(workflow.mainJob.name, sourceFile);
    }

    // Step 5: Identify jobs that are used but not exported
    const internalJobs: string[] = [];
    for (const jobName of tracedJobs.keys()) {
      if (!allJobsMap.has(jobName) && !mainJobSourceMap.has(jobName)) {
        // Job is neither exported nor a mainJob - it's a dependency-only job
        internalJobs.push(jobName);
      }
    }

    if (internalJobs.length > 0) {
      console.log(
        `ℹ️  Internal jobs (included via deps): ${internalJobs.join(", ")}`,
      );
    }

    const unusedJobs = Array.from(allJobsMap.keys()).filter(
      (jobName) => !tracedJobs.has(jobName),
    );
    if (unusedJobs.length > 0) {
      console.warn(
        `⚠️  Warning: Unused workflow jobs found: ${unusedJobs.join(", ")}`,
      );
    }

    // Step 6: Build result - include mainJobs even if not exported
    const result: Array<{
      name: string;
      exportName?: string;
      sourceFile: string;
    }> = [];

    for (const jobName of tracedJobs.keys()) {
      const exportedMetadata = allJobsMap.get(jobName);
      if (exportedMetadata) {
        // Job is exported - include with exportName
        result.push(exportedMetadata);
      } else {
        // Job is not exported - check if it's a mainJob (can be accessed via workflow)
        const workflowSourceFile = mainJobSourceMap.get(jobName);
        if (workflowSourceFile) {
          result.push({
            name: jobName,
            exportName: undefined, // Will be accessed via workflow.mainJob
            sourceFile: workflowSourceFile,
          });
        }
        // If not a mainJob either, it's an internal dep - no need to bundle separately
      }
    }

    return result;
  }

  /**
   * Load jobs and workflow from a file using dynamic import
   */
  private static async loadJobsFromFile(filePath: string): Promise<{
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

      // Check each export
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
          // Validate structure with Zod schema
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
      // File may have syntax errors or other issues, skip it
      console.error(`Failed to load ${filePath}:`, error);
    }

    return { jobs, workflow };
  }

  /**
   * Recursively trace all job dependencies, collecting job objects
   * This allows us to detect jobs that exist but are not exported
   */
  private static traceJobDependenciesWithObjects(
    job: WorkflowJob,
    visited: Map<string, WorkflowJob>,
  ): void {
    if (visited.has(job.name)) {
      return;
    }
    visited.set(job.name, job);

    if (job.deps && Array.isArray(job.deps)) {
      for (const dep of job.deps) {
        this.traceJobDependenciesWithObjects(dep, visited);
      }
    }
  }

  async load(jobFilePath: string): Promise<WorkflowJob | null> {
    const jobModule = await import(
      `${pathToFileURL(jobFilePath).href}?t=${Date.now()}`
    );

    // Try to find the job in exports
    let job;
    if (this.exportName) {
      // Load specific export by name
      job = jobModule[this.exportName];
    } else {
      // Try default export or find any job export using Symbol brand
      job =
        jobModule.default ||
        Object.values(jobModule).find((exp) => isWorkflowJob(exp));
    }

    const parseResult = WorkflowJobSchema.safeParse(job);
    if (!parseResult.success) {
      return null;
    }

    return parseResult.data;
  }
}
