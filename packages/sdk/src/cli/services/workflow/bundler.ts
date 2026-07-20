import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "#/cli/cache/bundle-cache";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import { composeFunctionTreeshakeOptions } from "#/cli/shared/function-treeshake";
import { logger, styles } from "#/cli/shared/logger";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { INVOKER_EXPR } from "#/cli/shared/runtime-exprs";
import { serializeStartContext, type StartContext } from "#/cli/shared/start-context";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";
import { findAllJobs } from "./job-detector";
import { transformWorkflowSource } from "./source-transformer";
import { detectResolvedStartCalls, hasStartCall, transformStartCalls } from "./start-transformer";
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
 * 2. Uses a transform plugin to transform start calls during bundling
 * 3. Creates an in-memory entry module and bundles with tree-shaking
 *
 * Returns metadata about which jobs each workflow uses.
 * @param allJobs - All available job infos
 * @param mainJobNames - Names of main jobs
 * @param env - Environment variables to inject
 * @param startContext - Start context for transformations
 * @param baseDir - Directory the owning config's tsconfig is resolved against
 * @param cache - Optional bundle cache for skipping unchanged builds
 * @param inlineSourcemap - Whether to enable inline sourcemaps
 * @param bundleLogLevel - Controls which console calls are kept in bundled code
 * @returns Workflow job bundling result
 */
export async function bundleWorkflowJobs(
  allJobs: JobInfo[],
  mainJobNames: string[],
  env: Record<string, string | number | boolean> = {},
  startContext: StartContext,
  baseDir: string,
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
): Promise<BundleWorkflowJobsResult> {
  if (allJobs.length === 0) {
    logger.warn("No workflow jobs to bundle");
    return { mainJobDeps: {}, usedJobNames: [], bundledCode: new Map() };
  }

  // Filter to only used jobs and get per-mainJob dependencies
  const { usedJobs, mainJobDeps } = await filterUsedJobs(allJobs, mainJobNames, startContext);

  logger.newline();
  logger.log(
    `Bundling ${styles.highlight(usedJobs.length.toString())} files for ${styles.info('"workflow-job"')}`,
  );

  const tsconfig = await resolveTSConfigWithFallback(baseDir);

  // Process each job, capped by TAILOR_BUNDLE_CONCURRENCY to bound native
  // memory use (each rolldown.build allocates its own module graph).
  const results = await withBundleConcurrency(usedJobs, (job) =>
    bundleSingleJob(
      job,
      usedJobs,
      tsconfig,
      env,
      startContext,
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
 * - It's called via .start() from another used job (transitively)
 *
 * Also returns a map of mainJob -> all jobs it depends on (for metadata).
 * @param allJobs - All available job infos
 * @param mainJobNames - Names of main jobs
 * @param startContext - Module binding metadata for resolving start targets
 * @returns Used jobs and main job dependency map
 */
async function filterUsedJobs(
  allJobs: JobInfo[],
  mainJobNames: string[],
  startContext: StartContext,
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

  // Detect start calls and build dependency graph
  // Maps job name -> set of job names it starts
  const dependencies = new Map<string, Set<string>>();

  // Process all source files in parallel
  const fileResults = await Promise.all(
    Array.from(jobsBySourceFile.entries()).map(async ([sourceFile, jobs]) => {
      try {
        const source = await fs.promises.readFile(sourceFile, "utf-8");
        const { program } = parseSync("input.ts", source);

        // Find all jobs in this file to get body ranges
        const detectedJobs = findAllJobs(program, source);
        const startCalls = detectResolvedStartCalls(program, source, startContext, sourceFile);

        // For each job in this file, find which start calls are inside its body
        const jobDependencies: Array<{ jobName: string; deps: Set<string> }> = [];

        for (const job of jobs) {
          const detectedJob = detectedJobs.find((d) => d.name === job.name);
          if (!detectedJob) continue;

          const jobDeps = new Set<string>();

          for (const call of startCalls) {
            // Check if this start call is inside the job's body
            if (
              call.kind === "job" &&
              call.callRange.start >= detectedJob.bodyValueRange.start &&
              call.callRange.end <= detectedJob.bodyValueRange.end
            ) {
              jobDeps.add(call.targetName);
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
  tsconfig: string | undefined,
  env: Record<string, string | number | boolean>,
  startContext: StartContext,
  cache?: BundleCache,
  inlineSourcemap?: boolean,
  bundleLogLevel: LogLevel = "DEBUG",
): Promise<[string, string]> {
  const serializedStartContext = serializeStartContext(startContext);

  // Include sorted env variables as a prefix so that env changes invalidate the cache
  const sortedEnvPrefix = JSON.stringify(
    Object.fromEntries(Object.entries(env).toSorted(([a], [b]) => a.localeCompare(b))),
  );
  const contextHash = computeBundlerContextHash({
    sourceFile: job.sourceFile,
    extraContext: serializedStartContext,
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
      const absoluteSourcePath = path.resolve(job.sourceFile);

      const entryContent = ml /* js */ `
        import { ${job.exportName} } from "${absoluteSourcePath}";

        export async function main(input) {
          const env = ${JSON.stringify(env)};
          const invoker = ${INVOKER_EXPR};
          return await ${job.exportName}.body(input, { env, invoker });
        }
      `;
      const entry = createVirtualEntry(`workflow-job:${job.name}`, entryContent);

      // Pre-compute once to avoid redundant realpathSync calls per module
      const resolvedSourceFile = safeRealpath(job.sourceFile);

      // Step 2: Bundle with a transform plugin that transforms start calls
      // Collect export names for enhanced AST removal (catches jobs missed by AST detection)
      const otherJobExportNames = allJobs
        .filter(
          (candidate) =>
            candidate.name !== job.name &&
            safeRealpath(candidate.sourceFile) === resolvedSourceFile,
        )
        .map((j) => j.exportName);

      // Create transform plugin to transform start calls and remove other job declarations
      const transformPlugin: rolldown.Plugin = {
        name: "workflow-transform",
        transform: {
          filter: {
            id: {
              include: [/\.(ts|mts|cts|js|mjs|cjs)$/],
            },
          },
          handler(code, id) {
            // Only transform source files that contain workflow jobs or start calls
            if (
              !code.includes("createWorkflowJob") &&
              !code.includes("createWorkflow") &&
              !hasStartCall(code)
            ) {
              return null;
            }

            // Only remove other jobs and the default workflow export from the job's
            // own source file. Dependency files imported by the source file must keep
            // their exports intact for rolldown to resolve cross-file
            // imports (e.g. `import workflow from "./other-workflow"`).
            let transformed = code;
            const isJobSourceFile = safeRealpath(id) === resolvedSourceFile;
            if (isJobSourceFile) {
              transformed = transformWorkflowSource(
                code,
                job.name,
                job.exportName,
                otherJobExportNames,
              );
            }

            // Apply workflow.start / job.start transformation.
            if (hasStartCall(transformed)) {
              transformed = transformStartCalls(transformed, startContext, id);
            }

            if (transformed === code) return null;
            return { code: transformed };
          },
        },
      };

      const plugins: rolldown.Plugin[] = [
        entry.plugin,
        transformPlugin,
        platformBundleDefinePlugin,
        ...cachePlugins,
      ];

      const result = await rolldown.build({
        input: entry.input,
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
