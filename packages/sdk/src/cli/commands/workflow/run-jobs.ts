import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseSync } from "oxc-parser";
import * as path from "pathe";
import { startContextAuth } from "#/cli/services/application";
import { bundleWorkflowJobs } from "#/cli/services/workflow/bundler";
import { findAllJobs } from "#/cli/services/workflow/job-detector";
import { createWorkflowService, type CollectedJob } from "#/cli/services/workflow/service";
import { buildOptionsOf, projectSourcesOf } from "#/cli/shared/build-options";
import { resolveBundleLogLevel } from "#/cli/shared/bundle-log-level";
import { effectiveDateDefault } from "#/cli/shared/date-default";
import { CLIError } from "#/cli/shared/errors";
import { functionEnv } from "#/cli/shared/function-env";
import { resolveInlineSourcemap } from "#/cli/shared/inline-sourcemap";
import { buildStartContext } from "#/cli/shared/start-context";
import { createTsconfigLookupCache } from "#/cli/shared/tsconfig-paths-plugin";
import { assertUniqueDefinitionNames } from "#/cli/shared/validation-errors";
import { workflowRunJobFunctionName } from "#/cli/shared/workflow-run-labels";
import type { FunctionRunTarget } from "../function/run-function";

interface BundleWorkflowRunJobsParams {
  /** File and application config of the run */
  target: FunctionRunTarget;
  /** Name of the workflow job to start with */
  jobName: string;
  /** Id of the run; names the job functions the jobs are registered under */
  runId: string;
}

interface BundledWorkflowRunJobs {
  /** Name of the job the run starts with */
  mainJobName: string;
  /** The selected job and every job it starts, transitively */
  jobs: Array<{ jobName: string; code: string }>;
}

// A file path is given to the workflow service as a pattern, so each character the pattern
// reads as syntax is put in a bracket, which matches it as it is. A backslash does not
// work here: pathe turns it into a slash.
function literalPattern(filePath: string): string {
  return filePath.replace(/[*?[{}()]/g, (char) => `[${char}]`);
}

function realPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

async function declaresJob(job: CollectedJob): Promise<boolean> {
  const source = await fs.promises.readFile(job.sourceFile, "utf-8");
  const { program } = parseSync(job.sourceFile, source);
  return findAllJobs(program, source).some((found) => found.name === job.name);
}

/**
 * Drop a job that another entry of the list holds as the very same definition, as a file does
 * when it re-exports a job of another file. The entry whose file declares the job stays, so the
 * bundler finds the declaration where it looks for it; when no file declares it, the later entry
 * stays.
 * @param jobs - Jobs of the file and of the application's workflow files
 * @returns The jobs without the repeated definitions
 */
async function withoutReExports(jobs: CollectedJob[]): Promise<CollectedJob[]> {
  // Imported without a user-module run nonce, which a file's own imports never carry:
  // a re-exporting file and the file it re-exports from then share one instance.
  const definitions = await Promise.all(
    jobs.map(async (job) => {
      const module: Record<string, unknown> = await import(pathToFileURL(job.sourceFile).href);
      return module[job.exportName];
    }),
  );
  const declared = await Promise.all(jobs.map(declaresJob));
  const sameDefinition = (job: CollectedJob, index: number, other: CollectedJob, at: number) =>
    at === index ||
    (other.name === job.name &&
      definitions[at] !== undefined &&
      definitions[at] === definitions[index]);
  return jobs.filter((job, index) => {
    const group = jobs.flatMap((other, at) => (sameDefinition(job, index, other, at) ? [at] : []));
    const keeper = group.find((at) => declared[at]) ?? group.at(-1);
    return keeper === index;
  });
}

/**
 * Bundle the selected workflow job together with the jobs it starts with
 * `.start()`, the way a deploy bundles a workflow, so that those calls work in
 * the temporary workflow. The jobs may come from the file or from the
 * application's workflow files. Each `.start()` is written to start the job
 * under the name this run registers it by, because job function names are
 * shared by the whole workspace and a deployed job may already use the plain name.
 * @param params - Target and run id
 * @returns The jobs to register
 */
export async function bundleWorkflowRunJobs(
  params: BundleWorkflowRunJobsParams,
): Promise<BundledWorkflowRunJobs> {
  const { target, runId, jobName } = params;
  const { config, filePath } = target;
  const baseDir = path.dirname(config.path);

  const fileService = createWorkflowService({
    config: { files: [literalPattern(filePath)] },
    baseDir,
  });
  await fileService.loadWorkflows();
  const appService = config.workflow
    ? createWorkflowService({ config: config.workflow, baseDir })
    : undefined;
  await appService?.loadWorkflows();

  const ownFile = realPath(filePath);
  const inFile = fileService.jobs;
  const seen = new Set(inFile.map((job) => `${realPath(job.sourceFile)}\0${job.name}`));
  const allJobs = await withoutReExports([
    ...inFile,
    ...(appService?.jobs ?? []).filter(
      (job) => !seen.has(`${realPath(job.sourceFile)}\0${job.name}`),
    ),
  ]);
  assertUniqueDefinitionNames({
    kind: "workflow-job",
    definitions: allJobs.map(({ name, sourceFile, exportName }) => ({
      name,
      file: sourceFile,
      exportName,
    })),
  });
  if (!inFile.some((job) => job.name === jobName)) {
    const available = inFile.map((job) => `  - "${job.name}" (export: ${job.exportName})`);
    throw CLIError({
      code: "WORKFLOW_JOB_NOT_FOUND",
      message: `Workflow job "${jobName}" not found in ${path.basename(ownFile)}.`,
      details: available.length > 0 ? `Available jobs:\n${available.join("\n")}` : undefined,
      suggestion: "Export a createWorkflowJob with that name from the file, or run without --job.",
      command: "workflow run",
    });
  }

  const tsconfigCache = createTsconfigLookupCache();
  // The application's files are read with its ignore rules, and the selected file on its own,
  // so that a file the config leaves out is not scanned just because a run goes through it.
  const { authNamespace, machineUserAuthNamespaces } = startContextAuth(config);
  const appStartContext = await buildStartContext(
    config.workflow ?? { files: [] },
    authNamespace,
    baseDir,
    appService?.workflowSources ?? [],
    tsconfigCache,
  );
  const fileStartContext = await buildStartContext(
    { files: [literalPattern(filePath)] },
    authNamespace,
    baseDir,
    fileService.workflowSources,
    tsconfigCache,
  );
  const baseStartContext = {
    ...appStartContext,
    machineUserAuthNamespaces,
    modules: new Map([...appStartContext.modules, ...fileStartContext.modules]),
  };
  const startContext = {
    ...baseStartContext,
    jobFunctionName: (name: string) => workflowRunJobFunctionName(runId, name),
  };

  const buildOptions = buildOptionsOf(config);
  const { bundledCode } = await bundleWorkflowJobs({
    allJobs,
    mainJobNames: [jobName],
    env: functionEnv(config, "workflow-job", filePath),
    startContext,
    baseDir,
    inlineSourcemap: resolveInlineSourcemap(buildOptions.inlineSourcemap),
    inlineSourcemapDependencySources: buildOptions.inlineSourcemapDependencySources,
    inlineSourcemapProjectSources: projectSourcesOf({ buildOptions, baseDir }),
    bundleLogLevel: resolveBundleLogLevel(buildOptions.logLevel),
    bundleTreeshake: buildOptions.treeshake,
    allowedRuntimeGlobals: buildOptions.allowedRuntimeGlobals,
    tsconfigCache,
    dateDefault: effectiveDateDefault(config),
    kyselyTemporal: target.kyselyTemporal ?? false,
    kyselyDecimal: target.kyselyDecimal ?? false,
  });

  return {
    mainJobName: jobName,
    jobs: [...bundledCode].map(([name, code]) => ({ jobName: name, code })),
  };
}
