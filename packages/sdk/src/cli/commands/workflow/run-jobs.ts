import * as fs from "node:fs";
import * as path from "pathe";
import { bundleWorkflowJobs } from "#/cli/services/workflow/bundler";
import { createWorkflowService } from "#/cli/services/workflow/service";
import { buildOptionsOf, projectSourcesOf } from "#/cli/shared/build-options";
import { resolveBundleLogLevel } from "#/cli/shared/bundle-log-level";
import { effectiveDateDefault } from "#/cli/shared/date-default";
import { CLIError } from "#/cli/shared/errors";
import { resolveInlineSourcemap } from "#/cli/shared/inline-sourcemap";
import { buildStartContext } from "#/cli/shared/start-context";
import { createTsconfigLookupCache } from "#/cli/shared/tsconfig-paths-plugin";
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

function realPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
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

  const fileService = createWorkflowService({ config: { files: [filePath] }, baseDir });
  await fileService.loadWorkflows();
  const appService = config.workflow
    ? createWorkflowService({ config: config.workflow, baseDir })
    : undefined;
  await appService?.loadWorkflows();

  const ownFile = realPath(filePath);
  const inFile = fileService.jobs;
  const seen = new Set(inFile.map((job) => `${realPath(job.sourceFile)}\0${job.name}`));
  const allJobs = [
    ...inFile,
    ...(appService?.jobs ?? []).filter(
      (job) => !seen.has(`${realPath(job.sourceFile)}\0${job.name}`),
    ),
  ];
  if (!inFile.some((job) => job.name === jobName)) {
    const available = inFile.map((job) => `  - "${job.name}" (export: ${job.exportName})`);
    throw CLIError({
      code: "WORKFLOW_RUN_JOB_NOT_FOUND",
      message: `Workflow job "${jobName}" not found in ${path.basename(ownFile)}.`,
      details: available.length > 0 ? `Available jobs:\n${available.join("\n")}` : undefined,
      suggestion: "Export a createWorkflowJob with that name from the file, or run without --job.",
      command: "workflow run",
    });
  }

  const tsconfigCache = createTsconfigLookupCache();
  const workflowSources = [...fileService.workflowSources, ...(appService?.workflowSources ?? [])];
  const baseStartContext = await buildStartContext(
    { files: [...(config.workflow?.files ?? []), filePath] },
    target.authNamespace,
    baseDir,
    workflowSources,
    tsconfigCache,
  );
  const startContext = {
    ...baseStartContext,
    jobFunctionName: (name: string) => workflowRunJobFunctionName(runId, name),
  };

  const buildOptions = buildOptionsOf(config);
  const { bundledCode } = await bundleWorkflowJobs({
    allJobs,
    mainJobNames: [jobName],
    env: config.env ?? {},
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
  });

  return {
    mainJobName: jobName,
    jobs: [...bundledCode].map(([name, code]) => ({ jobName: name, code })),
  };
}
