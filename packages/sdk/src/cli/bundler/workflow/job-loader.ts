import { pathToFileURL } from "node:url";
import { loadFilesWithIgnores } from "@/cli/application/file-loader";
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

/**
 * Collect all jobs from workflow configuration
 * This function collects all jobs from files matching the glob pattern,
 * then traces dependencies from mainJob to validate and filter.
 *
 * All jobs must be named exports - this ensures consistent bundling behavior.
 */
export async function collectAllJobs(
  config: WorkflowServiceConfig,
): Promise<Array<{ name: string; exportName: string; sourceFile: string }>> {
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
    const { jobs, workflow } = await loadJobsFromFile(jobFile);

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
    traceJobDependenciesWithObjects(workflow.mainJob, tracedJobs);
  }

  // Step 4: Validate all traced jobs are exported
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

  // Step 5: Warn about unused jobs
  const unusedJobs = Array.from(allJobsMap.keys()).filter(
    (jobName) => !tracedJobs.has(jobName),
  );
  if (unusedJobs.length > 0) {
    console.warn(
      `⚠️  Warning: Unused workflow jobs found: ${unusedJobs.join(", ")}`,
    );
  }

  // Step 6: Build result from traced jobs
  const result: Array<{
    name: string;
    exportName: string;
    sourceFile: string;
  }> = [];

  for (const jobName of tracedJobs.keys()) {
    const exportedMetadata = allJobsMap.get(jobName);
    // All jobs are guaranteed to be exported at this point (validated in Step 4)
    result.push(exportedMetadata!);
  }

  return result;
}

/**
 * Load jobs and workflow from a file using dynamic import
 */
async function loadJobsFromFile(filePath: string): Promise<{
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
function traceJobDependenciesWithObjects(
  job: WorkflowJob,
  visited: Map<string, WorkflowJob>,
): void {
  if (visited.has(job.name)) {
    return;
  }
  visited.set(job.name, job);

  if (job.deps && Array.isArray(job.deps)) {
    for (const dep of job.deps) {
      traceJobDependenciesWithObjects(dep, visited);
    }
  }
}

/**
 * Load a single workflow job from a file
 */
export async function loadWorkflowJob(
  jobFilePath: string,
  exportName?: string,
): Promise<WorkflowJob | null> {
  const jobModule = await import(
    `${pathToFileURL(jobFilePath).href}?t=${Date.now()}`
  );

  // Try to find the job in exports
  let job;
  if (exportName) {
    // Load specific export by name
    job = jobModule[exportName];
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
