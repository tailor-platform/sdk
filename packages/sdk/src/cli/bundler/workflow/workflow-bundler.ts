import * as fs from "node:fs";
import * as path from "node:path";
import ml from "multiline-ts";
import { parseSync } from "oxc-parser";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { enableInlineSourcemap } from "@/cli/bundler/inline-sourcemap";
import { logger, styles } from "@/cli/utils/logger";
import { getDistDir } from "@/configure/config";
import { detectTriggerCalls, findAllJobs } from "./job-detector";
import { transformWorkflowSource } from "./source-transformer";
import { transformFunctionTriggers } from "./trigger-transformer";
import type { TriggerContext } from "../trigger-context";

interface JobInfo {
  name: string;
  exportName: string;
  sourceFile: string;
}

export interface BundleWorkflowJobsResult {
  /** Maps mainJobName -> list of all job names it depends on (including itself) */
  mainJobDeps: Record<string, string[]>;
}

/**
 * Bundle workflow jobs
 *
 * This function:
 * 1. Detects which jobs are actually used (mainJobs + their dependencies)
 * 2. Uses a transform plugin to transform trigger calls during bundling
 * 3. Creates entry file and bundles with tree-shaking
 *
 * Returns metadata about which jobs each workflow uses.
 * @param {JobInfo[]} allJobs - All available job infos
 * @param {string[]} mainJobNames - Names of main jobs
 * @param {Record<string, string | number | boolean>} [env] - Environment variables to inject
 * @param {TriggerContext} [triggerContext] - Trigger context for transformations
 * @returns {Promise<BundleWorkflowJobsResult>} Workflow job bundling result
 */
export async function bundleWorkflowJobs(
  allJobs: JobInfo[],
  mainJobNames: string[],
  env: Record<string, string | number | boolean> = {},
  triggerContext?: TriggerContext,
): Promise<BundleWorkflowJobsResult> {
  if (allJobs.length === 0) {
    logger.warn("No workflow jobs to bundle");
    return { mainJobDeps: {} };
  }

  // Filter to only used jobs and get per-mainJob dependencies
  const { usedJobs, mainJobDeps } = await filterUsedJobs(allJobs, mainJobNames);

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(usedJobs.length.toString())} files for ${styles.info('"workflow-job"')}`,
  );

  const outputDir = path.resolve(getDistDir(), "workflow-jobs");

  // Clean up output directory before bundling to remove stale files
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each job
  await Promise.all(
    usedJobs.map((job) => bundleSingleJob(job, usedJobs, outputDir, tsconfig, env, triggerContext)),
  );

  logger.log(`${styles.success("Bundled")} ${styles.info('"workflow-job"')}`);

  return { mainJobDeps };
}

interface FilterUsedJobsResult {
  usedJobs: JobInfo[];
  mainJobDeps: Record<string, string[]>;
}

/**
 * Filter jobs to only include those that are actually used.
 * A job is "used" if:
 * - It's a mainJob of a workflow
 * - It's called via .trigger() from another used job (transitively)
 *
 * Also returns a map of mainJob -> all jobs it depends on (for metadata).
 * @param {JobInfo[]} allJobs - All available job infos
 * @param {string[]} mainJobNames - Names of main jobs
 * @returns {Promise<FilterUsedJobsResult>} Used jobs and main job dependency map
 */
async function filterUsedJobs(
  allJobs: JobInfo[],
  mainJobNames: string[],
): Promise<FilterUsedJobsResult> {
  if (allJobs.length === 0 || mainJobNames.length === 0) {
    return { usedJobs: [], mainJobDeps: {} };
  }

  // Build maps for lookups
  const jobsBySourceFile = new Map<string, JobInfo[]>();
  for (const job of allJobs) {
    const existing = jobsBySourceFile.get(job.sourceFile) || [];
    existing.push(job);
    jobsBySourceFile.set(job.sourceFile, existing);
  }

  // Build export name -> job name map for all jobs
  const exportNameToJobName = new Map<string, string>();
  for (const job of allJobs) {
    exportNameToJobName.set(job.exportName, job.name);
  }

  // Detect trigger calls and build dependency graph
  // Maps job name -> set of job names it triggers
  const dependencies = new Map<string, Set<string>>();

  // Process all source files in parallel
  const fileResults = await Promise.all(
    Array.from(jobsBySourceFile.entries()).map(async ([sourceFile, jobs]) => {
      try {
        const source = await fs.promises.readFile(sourceFile, "utf-8");
        const { program } = parseSync("input.ts", source);

        // Find all jobs in this file to get body ranges
        const detectedJobs = findAllJobs(program, source);
        const localExportNameToJobName = new Map<string, string>();
        for (const detected of detectedJobs) {
          if (detected.exportName) {
            localExportNameToJobName.set(detected.exportName, detected.name);
          }
        }

        // Detect trigger calls
        const triggerCalls = detectTriggerCalls(program, source);

        // For each job in this file, find which triggers are inside its body
        const jobDependencies: Array<{ jobName: string; deps: Set<string> }> = [];

        for (const job of jobs) {
          const detectedJob = detectedJobs.find((d) => d.name === job.name);
          if (!detectedJob) continue;

          const jobDeps = new Set<string>();

          for (const call of triggerCalls) {
            // Check if this trigger call is inside the job's body
            if (
              detectedJob.bodyValueRange &&
              call.callRange.start >= detectedJob.bodyValueRange.start &&
              call.callRange.end <= detectedJob.bodyValueRange.end
            ) {
              // Look up the job name from the identifier
              const triggeredJobName =
                localExportNameToJobName.get(call.identifierName) ||
                exportNameToJobName.get(call.identifierName);
              if (triggeredJobName) {
                jobDeps.add(triggeredJobName);
              }
            }
          }

          if (jobDeps.size > 0) {
            jobDependencies.push({ jobName: job.name, deps: jobDeps });
          }
        }

        return jobDependencies;
      } catch {
        // If we can't parse a file, assume no dependencies from it
        return [];
      }
    }),
  );

  // Merge results into dependencies map
  for (const jobDependencies of fileResults) {
    for (const { jobName, deps } of jobDependencies) {
      dependencies.set(jobName, deps);
    }
  }

  // Collect all used jobs and per-mainJob dependencies
  const usedJobNames = new Set<string>();
  const mainJobDeps: Record<string, string[]> = {};

  function collectDeps(jobName: string, collected: Set<string>) {
    if (collected.has(jobName)) return;
    collected.add(jobName);

    // Recursively collect dependencies
    const deps = dependencies.get(jobName);
    if (deps) {
      for (const dep of deps) {
        collectDeps(dep, collected);
      }
    }
  }

  // For each mainJob, collect all its dependencies
  for (const mainJobName of mainJobNames) {
    const depsForMainJob = new Set<string>();
    collectDeps(mainJobName, depsForMainJob);
    mainJobDeps[mainJobName] = Array.from(depsForMainJob);

    // Add to global used jobs
    for (const dep of depsForMainJob) {
      usedJobNames.add(dep);
    }
  }

  // Filter to only used jobs
  const usedJobs = allJobs.filter((job) => usedJobNames.has(job.name));
  return { usedJobs, mainJobDeps };
}

async function bundleSingleJob(
  job: JobInfo,
  allJobs: JobInfo[],
  outputDir: string,
  tsconfig: string | undefined,
  env: Record<string, string | number | boolean>,
  triggerContext?: TriggerContext,
): Promise<void> {
  // Step 1: Create entry file that imports job by named export
  const entryPath = path.join(outputDir, `${job.name}.entry.js`);
  const absoluteSourcePath = path.resolve(job.sourceFile).replace(/\\/g, "/");

  const entryContent = ml /* js */ `
    import { ${job.exportName} } from "${absoluteSourcePath}";

    const env = ${JSON.stringify(env)};

    export async function main(input) {
      return await ${job.exportName}.body(input, { env });
    }
  `;
  fs.writeFileSync(entryPath, entryContent);

  // Step 2: Bundle with a transform plugin that transforms trigger calls
  const outputPath = path.join(outputDir, `${job.name}.js`);

  // Collect export names for enhanced AST removal (catches jobs missed by AST detection)
  const otherJobExportNames = allJobs.filter((j) => j.name !== job.name).map((j) => j.exportName);

  // Build a map from export name to job name for trigger transformation
  const allJobsMap = new Map<string, string>();
  for (const j of allJobs) {
    allJobsMap.set(j.exportName, j.name);
  }

  // Create transform plugin to transform trigger calls and remove other job declarations
  const transformPlugin: rolldown.Plugin = {
    name: "workflow-transform",
    transform: {
      filter: {
        id: {
          include: [/\.ts$/, /\.js$/],
        },
      },
      handler(code, id) {
        // Only transform source files that contain workflow jobs or trigger calls
        if (
          !code.includes("createWorkflowJob") &&
          !code.includes("createWorkflow") &&
          !code.includes(".trigger(")
        ) {
          return null;
        }

        // First, apply existing workflow source transformation (removes other jobs, transforms job.trigger)
        let transformed = transformWorkflowSource(
          code,
          job.name,
          job.exportName,
          otherJobExportNames,
          allJobsMap,
        );

        // Then, apply workflow.trigger transformation if context is provided
        if (triggerContext && transformed.includes(".trigger(")) {
          transformed = transformFunctionTriggers(
            transformed,
            triggerContext.workflowNameMap,
            triggerContext.jobNameMap,
            triggerContext.workflowFileMap,
            id,
          );
        }

        return { code: transformed };
      },
    },
  };

  await rolldown.build(
    rolldown.defineConfig({
      input: entryPath,
      output: {
        file: outputPath,
        format: "esm",
        sourcemap: enableInlineSourcemap ? "inline" : true,
        minify: enableInlineSourcemap
          ? {
              mangle: {
                keepNames: true,
              },
            }
          : true,
        inlineDynamicImports: true,
      },
      tsconfig,
      plugins: [transformPlugin],
      treeshake: {
        moduleSideEffects: false,
        annotations: true,
        unknownGlobalSideEffects: false,
      },
      logLevel: "silent",
    }) as rolldown.BuildOptions,
  );
}
