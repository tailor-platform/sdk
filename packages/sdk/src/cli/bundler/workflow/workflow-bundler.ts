import * as fs from "node:fs";
import * as path from "node:path";
import { styleText } from "node:util";
import ml from "multiline-ts";
import { parseSync } from "oxc-parser";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
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

/**
 * Bundle workflow jobs
 *
 * This function:
 * 1. Detects which jobs are actually used (mainJobs + their dependencies)
 * 2. Uses a transform plugin to transform trigger calls during bundling
 * 3. Creates entry file and bundles with tree-shaking
 */
export async function bundleWorkflowJobs(
  allJobs: JobInfo[],
  mainJobNames: string[],
  env: Record<string, string | number | boolean> = {},
  triggerContext?: TriggerContext,
): Promise<void> {
  if (allJobs.length === 0) {
    console.log(styleText("dim", "No workflow jobs to bundle"));
    return;
  }

  // Filter to only used jobs (mainJobs + their dependencies)
  const usedJobs = await filterUsedJobs(allJobs, mainJobNames);

  console.log("");
  console.log(
    "Bundling",
    styleText("cyanBright", usedJobs.length.toString()),
    "files for",
    styleText("cyan", '"workflow-job"'),
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
    usedJobs.map((job) =>
      bundleSingleJob(job, usedJobs, outputDir, tsconfig, env, triggerContext),
    ),
  );

  console.log(
    styleText("green", "Bundled"),
    styleText("cyan", '"workflow-job"'),
  );
}

/**
 * Filter jobs to only include those that are actually used.
 * A job is "used" if:
 * - It's a mainJob of a workflow
 * - It's called via .trigger() from another used job (transitively)
 */
async function filterUsedJobs(
  allJobs: JobInfo[],
  mainJobNames: string[],
): Promise<JobInfo[]> {
  if (allJobs.length === 0 || mainJobNames.length === 0) {
    return [];
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
        const jobDependencies: Array<{ jobName: string; deps: Set<string> }> =
          [];

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

  // Find all used jobs starting from mainJobs
  const usedJobNames = new Set<string>();

  function markUsed(jobName: string) {
    if (usedJobNames.has(jobName)) return;
    usedJobNames.add(jobName);

    // Recursively mark dependencies as used
    const deps = dependencies.get(jobName);
    if (deps) {
      for (const dep of deps) {
        markUsed(dep);
      }
    }
  }

  // Start from mainJobs
  for (const mainJobName of mainJobNames) {
    markUsed(mainJobName);
  }

  // Filter to only used jobs
  return allJobs.filter((job) => usedJobNames.has(job.name));
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

    globalThis.main = async (input) => {
      return await ${job.exportName}.body(input, { env });
    };
  `;
  fs.writeFileSync(entryPath, entryContent);

  // Step 2: Bundle with a transform plugin that transforms trigger calls
  const outputPath = path.join(outputDir, `${job.name}.js`);

  // Collect export names for enhanced AST removal (catches jobs missed by AST detection)
  const otherJobExportNames = allJobs
    .filter((j) => j.name !== job.name)
    .map((j) => j.exportName);

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
        sourcemap: true,
        minify: true,
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
