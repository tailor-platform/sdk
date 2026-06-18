import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "#/cli/cache/bundle-cache";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import { getDistDir } from "#/cli/shared/dist-dir";
import { composeFunctionTreeshakeOptions } from "#/cli/shared/function-treeshake";
import { logger, styles } from "#/cli/shared/logger";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { INVOKER_EXPR } from "#/cli/shared/runtime-exprs";
import { serializeTriggerContext, type TriggerContext } from "#/cli/shared/trigger-context";
import ml from "#/utils/multiline";
import { detectTriggerCalls, findAllJobs } from "./job-detector";
import { transformWorkflowSource } from "./source-transformer";
import { transformFunctionTriggers } from "./trigger-transformer";
import type { LogLevel } from "#/configure/config/types";

function safeRealpath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync(resolved);
  } catch (e) {
    logger.debug(`realpathSync failed for ${resolved}: ${e instanceof Error ? e.message : e}`);
    return resolved;
  }
}

interface JobInfo {
  name: string;
  exportName: string;
  sourceFile: string;
}

export interface BundleWorkflowJobsResult {
  /** Maps mainJobName -> list of all job names it depends on (including itself) */
  mainJobDeps: Record<string, string[]>;
  /** Job names that were actually bundled */
  usedJobNames: string[];
  /** Maps job name to bundled code string */
  bundledCode: Map<string, string>;
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
 * @param allJobs - All available job infos
 * @param mainJobNames - Names of main jobs
 * @param env - Environment variables to inject
 * @param triggerContext - Trigger context for transformations
 * @param cache - Optional bundle cache for skipping unchanged builds
 * @param inlineSourcemap - Whether to enable inline sourcemaps
 * @param bundleLogLevel - Controls which console calls are kept in bundled code
 * @returns Workflow job bundling result
 */
export async function bundleWorkflowJobs(
  allJobs: JobInfo[],
  mainJobNames: string[],
  env: Record<string, string | number | boolean> = {},
  triggerContext?: TriggerContext,
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
): Promise<BundleWorkflowJobsResult> {
  if (allJobs.length === 0) {
    logger.warn("No workflow jobs to bundle");
    return { mainJobDeps: {}, usedJobNames: [], bundledCode: new Map() };
  }

  // Filter to only used jobs and get per-mainJob dependencies
  const { usedJobs, mainJobDeps } = await filterUsedJobs(allJobs, mainJobNames);

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(usedJobs.length.toString())} files for ${styles.info('"workflow-job"')}`,
  );

  const outputDir = path.resolve(getDistDir(), "workflow-jobs");

  // Remove stale output files (those not in the current build set)
  fs.mkdirSync(outputDir, { recursive: true });
  const currentJobNames = new Set(usedJobs.map((j) => j.name));
  const existingFiles = fs.readdirSync(outputDir);
  for (const file of existingFiles) {
    // Remove .js and .js.map files not belonging to current jobs (covers entry files, stale outputs, and sourcemaps)
    if (file.endsWith(".js") && !currentJobNames.has(path.basename(file, ".js"))) {
      fs.rmSync(path.join(outputDir, file), { force: true });
    } else if (file.endsWith(".js.map") && !currentJobNames.has(path.basename(file, ".js.map"))) {
      fs.rmSync(path.join(outputDir, file), { force: true });
    }
  }

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each job, capped by TAILOR_BUNDLE_CONCURRENCY to bound native
  // memory use (each rolldown.build allocates its own module graph).
  const results = await withBundleConcurrency(usedJobs, (job) =>
    bundleSingleJob(
      job,
      usedJobs,
      outputDir,
      tsconfig,
      env,
      triggerContext,
      cache,
      inlineSourcemap,
      bundleLogLevel,
    ),
  );

  const bundledCode = new Map<string, string>();
  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  logger.log(`${styles.success("Bundled")} ${styles.info('"workflow-job"')}`);

  return {
    mainJobDeps,
    usedJobNames: usedJobs.map((job) => job.name),
    bundledCode,
  };
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
 * @param allJobs - All available job infos
 * @param mainJobNames - Names of main jobs
 * @returns Used jobs and main job dependency map
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
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
): Promise<[string, string]> {
  const serializedTriggerContext = serializeTriggerContext(triggerContext);

  // Include sorted env variables as a prefix so that env changes invalidate the cache
  const sortedEnvPrefix = JSON.stringify(
    Object.fromEntries(Object.entries(env).toSorted(([a], [b]) => a.localeCompare(b))),
  );
  const contextHash = computeBundlerContextHash({
    sourceFile: job.sourceFile,
    serializedTriggerContext,
    tsconfig,
    inlineSourcemap,
    bundleLogLevel,
    prefix: sortedEnvPrefix,
  });

  const code = await withCache({
    cache,
    kind: "workflow-job",
    name: job.name,
    sourceFile: job.sourceFile,
    contextHash,
    async build(cachePlugins) {
      // Step 1: Create entry file that imports job by named export
      const entryPath = path.join(outputDir, `${job.name}.entry.js`);
      const absoluteSourcePath = path.resolve(job.sourceFile);

      const entryContent = ml /* js */ `
        import { ${job.exportName} } from "${absoluteSourcePath}";

        export async function main(input) {
          const env = ${JSON.stringify(env)};
          const invoker = ${INVOKER_EXPR};
          return await ${job.exportName}.body(input, { env, invoker });
        }
      `;
      fs.writeFileSync(entryPath, entryContent);

      // Step 2: Bundle with a transform plugin that transforms trigger calls
      // Collect export names for enhanced AST removal (catches jobs missed by AST detection)
      const otherJobExportNames = allJobs
        .filter((j) => j.name !== job.name)
        .map((j) => j.exportName);

      // Build a map from export name to job name for trigger transformation
      const allJobsMap = new Map<string, string>();
      for (const j of allJobs) {
        allJobsMap.set(j.exportName, j.name);
      }

      // Pre-compute once to avoid redundant realpathSync calls per module
      const resolvedSourceFile = safeRealpath(job.sourceFile);

      // Create transform plugin to transform trigger calls and remove other job declarations
      const transformPlugin: rolldown.Plugin = {
        name: "workflow-transform",
        transform: {
          filter: {
            id: {
              include: [/\.(ts|mts|cts|js|mjs|cjs)$/],
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

            // Only apply workflow source transformation (job removal, default
            // export removal, intra-file trigger rewriting) to the job's own
            // source file. Dependency files imported by the source file must
            // keep their exports intact for rolldown to resolve cross-file
            // imports (e.g. `import workflow from "./other-workflow"`).
            let transformed = code;
            const isJobSourceFile = safeRealpath(id) === resolvedSourceFile;
            if (isJobSourceFile) {
              transformed = transformWorkflowSource(
                code,
                job.name,
                job.exportName,
                otherJobExportNames,
                allJobsMap,
              );
            }

            // Apply workflow.trigger / job.trigger transformation if context is provided
            if (triggerContext && transformed.includes(".trigger(")) {
              transformed = transformFunctionTriggers(
                transformed,
                triggerContext.workflowNameMap,
                triggerContext.jobNameMap,
                triggerContext.workflowFileMap,
                id,
                triggerContext.authNamespace,
              );
            }

            if (transformed === code) return null;
            return { code: transformed };
          },
        },
      };

      const plugins: rolldown.Plugin[] = [
        transformPlugin,
        platformBundleDefinePlugin,
        ...cachePlugins,
      ];

      const result = await rolldown.build({
        input: entryPath,
        write: false,
        output: {
          format: "esm",
          sourcemap: inlineSourcemap ? "inline" : true,
          minify: inlineSourcemap
            ? {
                mangle: {
                  keepNames: true,
                },
              }
            : true,
          codeSplitting: false,
        },
        tsconfig,
        plugins,
        treeshake: composeFunctionTreeshakeOptions([
          createLogLevelTreeshakeOptions(bundleLogLevel),
        ]),
        logLevel: "silent",
      } as rolldown.BuildOptions);

      return result.output[0].code;
    },
  });

  return [job.name, code];
}
