import * as fs from "node:fs";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import * as rolldown from "rolldown";
import { computeBundlerContextHash, withCache, type BundleCache } from "#/cli/cache/bundle-cache";
import { withBundleConcurrency } from "#/cli/shared/bundle-concurrency";
import { createBundleLog } from "#/cli/shared/bundle-log";
import { createLogLevelTreeshakeOptions } from "#/cli/shared/bundle-log-level";
import { assertNoForbiddenRuntimeGlobals } from "#/cli/shared/forbidden-runtime-globals";
import { composeFunctionTreeshakeOptions } from "#/cli/shared/function-treeshake";
import { logger, styles } from "#/cli/shared/logger";
import { platformBundleDefinePlugin } from "#/cli/shared/platform-bundle-plugin";
import { resolveTSConfigWithFallback } from "#/cli/shared/resolve-tsconfig";
import { INVOKER_EXPR } from "#/cli/shared/runtime-exprs";
import { serializeStartContext, type StartContext } from "#/cli/shared/start-context";
import {
  createTsconfigPathsPlugin,
  type TsconfigLookupCache,
} from "#/cli/shared/tsconfig-paths-plugin";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import ml from "#/utils/multiline";
import { getModuleExportName, type ASTNode } from "./ast-utils";
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

/**
 * Thrown when a job's dependency graph cannot be statically determined, so the
 * job or a call to it would otherwise be silently dropped from the bundle.
 */
class WorkflowJobDetectionError extends Error {}

function isExecJobFunctionCallee(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const callee = node as ASTNode;
  if (callee.type !== "MemberExpression") return false;
  const property = callee.property as ASTNode | undefined;
  if (property?.type !== "Identifier" || property.name !== "execJobFunction") return false;
  const object = callee.object as ASTNode | undefined;
  if (object?.type !== "MemberExpression") return false;
  const workflowProperty = object.property as ASTNode | undefined;
  if (workflowProperty?.type !== "Identifier" || workflowProperty.name !== "workflow") {
    return false;
  }
  const root = object.object as ASTNode | undefined;
  return root?.type === "Identifier" && root.name === "tailor";
}

function extractStaticStringValue(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  const value = node as ASTNode;
  if (value.type === "Literal" && typeof value.value === "string") {
    return value.value;
  }
  if (value.type === "TemplateLiteral") {
    const quasis = value.quasis as Array<{ value?: { cooked?: string } }> | undefined;
    const expressions = value.expressions as unknown[] | undefined;
    if (quasis?.length === 1 && (expressions?.length ?? 0) === 0) {
      return quasis[0]?.value?.cooked;
    }
  }
  return undefined;
}

const RUNTIME_WORKFLOW_MODULE_SPECIFIERS = new Set([
  "@tailor-platform/sdk/runtime",
  "@tailor-platform/sdk/runtime/workflow",
]);

function collectRuntimeWorkflowImportBindings(program: ASTNode): Set<string> {
  const bindings = new Set<string>();
  for (const statement of (program.body as ASTNode[] | undefined) ?? []) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
    const source = statement.source as ASTNode | undefined;
    if (
      typeof source?.value !== "string" ||
      !RUNTIME_WORKFLOW_MODULE_SPECIFIERS.has(source.value)
    ) {
      continue;
    }
    for (const specifier of (statement.specifiers as ASTNode[] | undefined) ?? []) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const imported = getModuleExportName(specifier.imported);
      const local = getModuleExportName(specifier.local);
      if (imported === "workflow" && local) bindings.add(local);
    }
  }
  return bindings;
}

function isDirectExecJobFunctionCallee(
  node: unknown,
  runtimeWorkflowBindings: ReadonlySet<string>,
): boolean {
  if (isExecJobFunctionCallee(node)) return true;
  if (!node || typeof node !== "object") return false;
  const callee = node as ASTNode;
  if (callee.type !== "MemberExpression") return false;
  const property = callee.property as ASTNode | undefined;
  if (property?.type !== "Identifier" || property.name !== "execJobFunction") return false;
  const object = callee.object as ASTNode | undefined;
  return object?.type === "Identifier" && runtimeWorkflowBindings.has(object.name as string);
}

interface DirectExecJobFunctionCall {
  targetName: string | undefined;
}

/**
 * Find calls to `execJobFunction` written directly in workflow source, on
 * either the ambient `tailor.workflow` global or a `workflow` value imported
 * from `@tailor-platform/sdk/runtime`(`/workflow`) (aliases included). Such a
 * call is never recognized as a dependency, so its target would silently be
 * dropped from the bundle unless something else happens to reference it.
 * @param program - Parsed workflow file AST
 * @returns Every direct execJobFunction call found, with its static target
 * name when the first argument is a string literal
 */
function findDirectExecJobFunctionCalls(program: ASTNode): DirectExecJobFunctionCall[] {
  const runtimeWorkflowBindings = collectRuntimeWorkflowImportBindings(program);
  const calls: DirectExecJobFunctionCall[] = [];

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "CallExpression" &&
      isDirectExecJobFunctionCallee(node.callee, runtimeWorkflowBindings)
    ) {
      const args = node.arguments as unknown[] | undefined;
      calls.push({ targetName: extractStaticStringValue(args?.[0]) });
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(program);
  return calls;
}

function buildDirectExecJobFunctionErrorMessage(
  sourceFile: string,
  call: DirectExecJobFunctionCall,
): string {
  if (call.targetName !== undefined) {
    return (
      `Workflow file ${sourceFile} calls execJobFunction("${call.targetName}", ...) directly. A ` +
      `direct call is never recognized as a dependency, so "${call.targetName}" would silently be ` +
      `dropped from the bundle unless something else happens to reference it. Call the ` +
      `"${call.targetName}" job's .start(...) method from inside a job body instead.`
    );
  }
  return (
    `Workflow file ${sourceFile} calls execJobFunction(...) directly with a job name that isn't a ` +
    `string literal, so the target can't be resolved at build time. Call the target job's own ` +
    `.start(...) method from inside a job body instead of calling execJobFunction directly.`
  );
}

/**
 * Find the job names a bundled job's code calls `execJobFunction` on, by
 * looking for `tailor.workflow.execJobFunction(<name>, ...)` calls with a
 * static string name.
 * @param code - Bundled job code
 * @returns Target job names referenced with a statically known name
 */
export function collectExecJobFunctionTargets(code: string): string[] {
  const { program, errors } = parseSync("input.js", code);
  if (errors.length > 0) {
    throw new WorkflowJobDetectionError(
      `Failed to parse bundled job code while checking for missed dependencies: ` +
        `${errors.map((e) => e.message).join("; ")}`,
    );
  }
  const targets: string[] = [];

  function walk(node: ASTNode | null | undefined): void {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && isExecJobFunctionCallee(node.callee)) {
      const args = node.arguments as unknown[] | undefined;
      const target = extractStaticStringValue(args?.[0]);
      if (target !== undefined) targets.push(target);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        child.forEach((c: unknown) => walk(c as ASTNode | null));
      } else if (child && typeof child === "object") {
        walk(child as ASTNode);
      }
    }
  }

  walk(program as unknown as ASTNode);
  return targets;
}

/**
 * Check every bundled job's code for execJobFunction targets that were not
 * bundled, throwing a WorkflowJobDetectionError naming the caller job when
 * one is found (or when the caller's own bundled code fails to parse).
 * @param bundledCode - Bundled job code by job name
 * @param usedJobNames - Job names that were actually bundled
 */
export function validateBundledDependencies(
  bundledCode: Map<string, string>,
  usedJobNames: readonly string[],
): void {
  const usedJobNameSet = new Set(usedJobNames);
  for (const [callerJobName, code] of bundledCode) {
    let targets: string[];
    try {
      targets = collectExecJobFunctionTargets(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WorkflowJobDetectionError(
        `Failed to check the bundled output of workflow job "${callerJobName}" for missed ` +
          `dependencies: ${message}`,
      );
    }

    for (const targetJobName of targets) {
      if (!usedJobNameSet.has(targetJobName)) {
        throw new WorkflowJobDetectionError(
          `Workflow job "${callerJobName}" calls execJobFunction("${targetJobName}", ...) — usually the ` +
            `result of a rewritten "${targetJobName}" job .start() call — but "${targetJobName}" was not ` +
            `detected as a dependency and is not included in the bundle. Call the "${targetJobName}" job's ` +
            `.start() method from inside the body of workflow job "${callerJobName}" (a nested function ` +
            `inside body works too), or make sure the file containing the call is covered by the workflow ` +
            `service's "files" pattern.`,
        );
      }
    }
  }
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
 * @param tsconfigCache - Optional tsconfig lookup cache shared across bundles in this CLI run
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
  tsconfigCache?: TsconfigLookupCache,
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
      tsconfigCache,
    ),
  );

  const bundledCode = new Map<string, string>();
  for (const [name, code] of results) {
    bundledCode.set(name, code);
  }

  // Backstop for dependency-graph gaps the source-level checks in
  // filterUsedJobs cannot see (e.g. a factored-out .start() call inside a
  // helper file outside `workflow.files`): the rewrite still resolves and
  // produces a valid execJobFunction call, but the target was never bundled.
  // Runs before the success log below so a failure here doesn't print a
  // misleading "Bundled" message right before throwing.
  validateBundledDependencies(
    bundledCode,
    usedJobs.map((job) => job.name),
  );

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

  // Files with no job of their own (e.g. a shared helper module factoring out
  // .start() calls) still need scanning for stray start calls below; otherwise
  // a call factored into such a file is never checked at all.
  const filesToScan = new Map(jobsBySourceFile);
  const knownRealpaths = new Set([...jobsBySourceFile.keys()].map(safeRealpath));
  for (const binding of startContext.modules.values()) {
    if (!knownRealpaths.has(safeRealpath(binding.sourceFile))) {
      filesToScan.set(binding.sourceFile, []);
    }
  }

  // Detect start calls and build dependency graph
  // Maps job name -> set of job names it starts
  const dependencies = new Map<string, Set<string>>();

  // Process all source files in parallel
  const fileResults = await Promise.all(
    Array.from(filesToScan.entries()).map(async ([sourceFile, jobs]) => {
      try {
        const source = await fs.promises.readFile(sourceFile, "utf-8");
        const { program, errors } = parseSync(sourceFile, source);
        if (errors.length > 0) {
          throw new WorkflowJobDetectionError(
            `Failed to parse ${sourceFile}: ${errors.map((e) => e.message).join("; ")}`,
          );
        }

        const [firstDirectExecCall] = findDirectExecJobFunctionCalls(program as unknown as ASTNode);
        if (firstDirectExecCall) {
          throw new WorkflowJobDetectionError(
            buildDirectExecJobFunctionErrorMessage(sourceFile, firstDirectExecCall),
          );
        }

        // Find all jobs in this file to get body ranges
        const detectedJobs = findAllJobs(program, source);
        const startCalls = detectResolvedStartCalls(program, source, startContext, sourceFile);

        // For each job in this file, find which start calls are inside its body
        const jobDependencies: Array<{ jobName: string; deps: Set<string> }> = [];

        for (const job of jobs) {
          const detectedJob = detectedJobs.find((d) => d.name === job.name);
          if (!detectedJob) {
            throw new WorkflowJobDetectionError(
              `Workflow job "${job.name}" (export "${job.exportName}" in ${sourceFile}) could not be ` +
                `statically detected: createWorkflowJob's "name" must be a string literal and "body" ` +
                `must be a function expression. Dynamic or computed values (e.g. body: someWrapper(fn)) ` +
                `cannot be bundled and would be silently dropped.`,
            );
          }

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

        for (const call of startCalls) {
          if (call.kind !== "job") continue;
          const isInsideAJobBody = detectedJobs.some(
            (detectedJob) =>
              call.callRange.start >= detectedJob.bodyValueRange.start &&
              call.callRange.end <= detectedJob.bodyValueRange.end,
          );
          if (!isInsideAJobBody) {
            throw new WorkflowJobDetectionError(
              `Call to job "${call.targetName}".start() in ${sourceFile} is not inside any workflow ` +
                `job's body: it was factored into a function defined outside the calling job's body. ` +
                `Dependency detection only sees .start() calls lexically inside a job body, so this call ` +
                `would silently drop "${call.targetName}" from the bundle. Move the call to a function ` +
                `defined inside the calling job's body.`,
            );
          }
        }

        return jobDependencies;
      } catch (error) {
        if (error instanceof WorkflowJobDetectionError) throw error;
        // Some other unexpected error (e.g. a file read failure): treat the
        // file as having no dependencies rather than failing the whole build.
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
  tsconfigCache?: TsconfigLookupCache,
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
    async build(cachePlugins, trackDependency) {
      const absoluteSourcePath = path.resolve(job.sourceFile);

      const entryContent = ml /* js */ `
        import { ${job.exportName} } from "${absoluteSourcePath}";

        export async function main(input) {
          const env = ${JSON.stringify(env)};
          const invoker = ${INVOKER_EXPR};
          return await ${job.exportName}.body(input, { env, invoker });
        }
      `;
      const entry = createVirtualEntry(
        `workflow-job:${job.name}`,
        entryContent,
        "js",
        absoluteSourcePath,
      );

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
        createTsconfigPathsPlugin({ onTsconfigRead: trackDependency, cache: tsconfigCache }),
        platformBundleDefinePlugin,
        ...cachePlugins,
      ];

      const bundleLog = createBundleLog({ tsconfig });
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
        ...bundleLog.options,
      } as rolldown.BuildOptions);
      bundleLog.assertAllResolved();

      const bundledCode = result.output[0].code;
      assertNoForbiddenRuntimeGlobals(bundledCode, `Workflow job "${job.name}"`);
      return bundledCode;
    },
  });

  return [job.name, code];
}
