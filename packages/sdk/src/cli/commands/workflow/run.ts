import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { create } from "@bufbuild/protobuf";
import { arg } from "@politty/zod";
import { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";
import * as path from "pathe";
import { z } from "zod";
import {
  configArg,
  durationArg,
  parseDuration,
  resolveMachineUserInputSource,
  workspaceArgs,
} from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { CLIError, isCLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertWritable } from "#/cli/shared/readonly-guard";
import {
  assertPollInterval,
  assertWaitTimeout,
  assertWorkflowArg,
  awaitWorkflowRun,
  startWorkflowRun,
  workflowRunHints,
} from "#/cli/shared/workflow-run";
import { createRunId, workflowRunJobFunctionName } from "#/cli/shared/workflow-run-labels";
import { sweepBeforeRun } from "#/cli/shared/workflow-run-sweep";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { assertDefined } from "#/utils/assert";
import { detectFunctionType } from "../function/detect";
import {
  resolveArgOptions,
  resolveAuthNamespace,
  resolveMachineUser,
  resolveMachineUserName,
} from "../function/run";
import {
  argumentToSend,
  executionRecord,
  type FunctionRunTarget,
  type PreparedFunction,
  printExecutionDetails,
} from "../function/run-function";
import { bundleWorkflowRunJobs } from "./run-jobs";

const PRUNE_COMMAND = "tailor workflow prune";

export const runCommand = defineAppCommand({
  name: "run",
  description:
    "Run a workflow job with the jobs it starts, as a temporary workflow without deploying.",
  args: z.strictObject({
    ...workspaceArgs,
    file: arg(z.string(), {
      positional: true,
      description: "Path to the file that defines the workflow job",
    }),
    job: arg(z.string().optional(), {
      description:
        "Workflow job to run, with the jobs it starts (matches the `name` field of createWorkflowJob). Optional when the file defines only one job.",
    }),
    arg: arg(z.string().optional(), {
      alias: "a",
      description: "JSON object to pass to the job as its input",
    }),
    "arg-file": arg(z.string().optional(), {
      description: "Path to a JSON file holding the object to pass to the job as its input",
    }),
    "machine-user": arg(z.string().optional(), {
      alias: "m",
      description:
        "Machine user name for authentication. Falls back to the active profile's default machine user.",
      env: "TAILOR_PLATFORM_MACHINE_USER_NAME",
    }),
    interval: arg(durationArg.default("3s"), {
      alias: "i",
      description: "Polling interval when waiting, at most 1m (e.g., '3s', '500ms', '1m')",
    }),
    timeout: arg(durationArg.optional(), {
      alias: "t",
      description:
        "Maximum time to wait for the run, not a limit on its jobs; waits without a limit when omitted (e.g., '30s', '10m')",
    }),
    ...configArg,
  }),
  notes: `The workflow job runs as a temporary workflow, so the job you are editing runs the way it does once deployed, without a deploy. The job is the first job of the temporary workflow, and every job it starts with \`.start()\` is registered with it. A job that calls \`.start()\` is suspended until the started job finishes and then continues with its result, so work that does not fit in one job is split into jobs and carried across them. The command waits for the whole run, prints the logs of every job and the result of the first job, and removes the temporary resources afterwards.

A single job is ended by the Platform after 5 minutes, and the run is reported as failed with a timeout error. The command waits until the run ends; \`--timeout\` limits how long it waits, not how long the jobs may run.

The file must export workflow jobs created with \`createWorkflowJob\`; a file that defines no workflow job is refused. Without \`--job\`, the run starts from the main job of the workflow the file exports as default, or from the only job when the file defines just one; \`--job\` selects another job to start from. A workflow whose main job is defined in another file is refused: pass the file that defines the job. The jobs it starts run from your files, not the ones already deployed under the same names, and the jobs of files in the config's \`workflow.files\` can be started too. The input must be a JSON object (\`null\` is accepted too): unlike \`function run\`, a number, string, boolean, or array is refused before anything is created. \`tailor workflow scaffold\` scaffolds a workflow to start from.

When the wait stops (\`--timeout\` elapsed), the run keeps going and its temporary resources stay in place. The command prints the run ID; read the outcome with \`tailor workflow executions\`. \`${PRUNE_COMMAND}\` removes the resources of runs that have finished, and the next \`workflow run\` does the same before it starts. A run that finished within the last few minutes is left alone by that automatic sweep (and by \`tailor deploy\`), so the command still waiting for it can read its result; \`${PRUNE_COMMAND}\` removes it at once.`,
  examples: [
    {
      cmd: 'workflows/jobs.ts --job send-report --arg \'{"id":"42"}\'',
      desc: "Run one workflow job together with the jobs it starts",
    },
    {
      cmd: "workflows/jobs.ts --job process-order --arg-file ./order.json --timeout 30m",
      desc: "Run a job from a file of arguments and wait up to 30 minutes for the whole run",
    },
  ],
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const pollInterval = parseDuration(args.interval);
    assertPollInterval(pollInterval);
    const timeoutMs =
      args.timeout === undefined ? Number.POSITIVE_INFINITY : parseDuration(args.timeout);
    assertWaitTimeout(timeoutMs);
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    const filePath = path.resolve(args.file);
    if (!fs.existsSync(filePath)) {
      throw CLIError({ code: "FILE_NOT_FOUND", message: `File not found: ${filePath}` });
    }
    const { arg: functionArg } = resolveArgOptions({
      arg: args.arg,
      argFile: args["arg-file"],
      watch: false,
      command: "workflow run",
    });
    assertWorkflowArg(functionArg?.value);

    const { config, plugins } = await loadConfig(args.config);
    const authNamespace = resolveAuthNamespace(config.auth);
    const machineUserName = await resolveMachineUserName({
      cliMachineUser: args["machine-user"],
      cliMachineUserSource: resolveMachineUserInputSource(args["machine-user"]),
      profile: args.profile,
      authConfig: config.auth,
    });
    const machineUser = await resolveMachineUser({
      client,
      workspaceId,
      authNamespace,
      machineUserName,
      authConfig: config.auth,
    });
    assertJobSource({ filePath, job: args.job });
    const workflowRequired = (found?: string) =>
      CLIError({
        code: "WORKFLOW_RUN_WORKFLOW_REQUIRED",
        message: `${filePath} defines no workflow job${found === undefined ? "" : ` (found: ${found})`}.`,
        suggestion:
          "Export a workflow job created with createWorkflowJob; `tailor workflow scaffold` scaffolds one.",
        command: "workflow run",
      });
    const detected = await detectFunctionType({
      filePath,
      jobName: args.job,
      jobFlag: "--job",
      useWorkflowMainJob: true,
    }).catch((error: unknown) => {
      throw isCLIError(error) && error.code === "FUNCTION_TYPE_UNDETECTED"
        ? workflowRequired()
        : error;
    });
    if (detected.type !== "workflow-job") throw workflowRequired(detected.type);
    const target: FunctionRunTarget = {
      filePath,
      jobName: detected.name,
      config,
      kyselyTemporal: resolvePluginConfig(plugins, KyselyGeneratorID)?.temporal ?? false,
      client,
      workspaceId,
      authNamespace,
      machineUser,
    };
    const runId = createRunId(new Date(), crypto.randomBytes(3).toString("hex"));
    const progress = (message: string) => logger.info(message);
    progress(`Bundling job "${detected.name}" with the jobs it starts...`);
    const bundled = await bundleWorkflowRunJobs({ target, runId, jobName: detected.name });
    const main = assertDefined(
      bundled.jobs.find((job) => job.jobName === bundled.mainJobName),
      "main job missing from the bundle",
    );
    const prepared: PreparedFunction = {
      scriptName: workflowRunJobFunctionName(runId, main.jobName),
      bundledCode: main.code,
      functionType: "workflow-job",
      functionName: main.jobName,
      acceptsArg: true,
      sourceFiles: [filePath],
    };
    const source: RunSource = {
      mainJobName: bundled.mainJobName,
      jobs: bundled.jobs,
    };

    await sweepBeforeRun({ client, workspaceId, profile: args.profile });

    const started = await startWorkflowRun({
      ...source,
      client,
      workspaceId,
      runId,
      description: `tailor workflow run ${path.basename(filePath)}`,
      invoker: create(AuthInvokerSchema, {
        namespace: authNamespace,
        machineUserName: machineUser.name,
      }),
      arg: argumentToSend(prepared, functionArg),
    });
    logger.info(`Run ID: ${started.runId}  Execution ID: ${started.executionId}`);

    const hints = workflowRunHints({
      executionId: started.executionId,
      workspaceId,
      profile: args.profile,
    });
    const onInterrupt = () => {
      logger.warn(
        `Stopped waiting. Run ${started.runId} keeps running; read it with ${hints.inspect}, then ${hints.prune}.`,
      );
      process.exit(130);
    };
    process.once("SIGINT", onInterrupt);
    const outcome = await awaitWorkflowRun({
      client,
      workspaceId,
      started,
      pollInterval,
      timeoutMs,
    }).finally(() => process.off("SIGINT", onInterrupt));

    if (outcome.state === "timedOut") {
      throw CLIError({
        code: "WORKFLOW_RUN_WAIT_TIMEOUT",
        message: `Stopped waiting for run ${started.runId}; the run is still going.`,
        suggestion: `Read the outcome with ${hints.inspect}. Afterwards, ${hints.prune} removes the temporary resources.`,
        context: { runId: started.runId, executionId: started.executionId },
      });
    }

    if (outcome.state === "outcomeUnavailable") {
      throw CLIError({
        code: "WORKFLOW_RUN_OUTCOME_UNAVAILABLE",
        message: outcome.workflowRemoved
          ? `The temporary workflow of run ${started.runId} was removed, so its result could not be read: ${outcome.reason}`
          : `Run ${started.runId} finished, but its result could not be read: ${outcome.reason}`,
        suggestion: outcome.workflowRemoved
          ? "The jobs themselves run to their end, but the execution can no longer be read through the workflow."
          : `Read it with ${hints.inspect}. Afterwards, ${hints.prune} removes the temporary resources.`,
        context: { runId: started.runId, executionId: started.executionId },
      });
    }

    const { result } = outcome;
    if (logger.jsonMode) {
      logger.out({
        ...executionRecord(prepared, result),
        runId: started.runId,
        executionId: started.executionId,
      });
    } else {
      if (result.success) logger.success("Execution succeeded");
      else logger.error("Execution failed");
      printExecutionDetails(
        {
          ...prepared,
          bundledCode: outcomeBundle({
            source,
            runId: started.runId,
            jobFunctionName: result.jobFunctionName,
            fallback: prepared.bundledCode,
          }),
        },
        result,
      );
    }
    if (!result.success) {
      // Exiting at once would cut off what is still queued for a pipe.
      const queued = [process.stdout, process.stderr].filter((stream) => stream.writableLength > 0);
      await Promise.all(
        queued.map((stream) => new Promise<void>((resolve) => stream.write("", () => resolve()))),
      );
      process.exit(1);
    }
  },
});

type RunSource = {
  mainJobName: string;
  jobs: Array<{ jobName: string; code: string }>;
};

interface OutcomeBundleParams {
  /** What the run registered */
  source: RunSource;
  /** Id of the run, which names the job functions */
  runId: string;
  /** Job function the outcome was read from */
  jobFunctionName: string | undefined;
  /** Bundle to use when the job is not one of the registered ones */
  fallback: string;
}

/**
 * Pick the bundle of the job an outcome was read from, whose sourcemap maps the stack of its error.
 * @param params - What the run registered and which job reported
 * @returns Bundled code of that job
 */
export function outcomeBundle(params: OutcomeBundleParams): string {
  const match = params.source.jobs.find(
    (job) => workflowRunJobFunctionName(params.runId, job.jobName) === params.jobFunctionName,
  );
  return match?.code ?? params.fallback;
}

interface JobSourceParams {
  /** Absolute path of the file */
  filePath: string;
  /** `--job` value, when given */
  job: string | undefined;
}

/**
 * Refuse a pre-bundled file, which holds no workflow job source to run.
 * @param params - File and `--job`
 */
export function assertJobSource(params: JobSourceParams): void {
  if (!params.filePath.endsWith(".js")) return;
  throw CLIError({
    code: "WORKFLOW_RUN_BUNDLED_FILE",
    message: `${params.filePath} is a pre-bundled file, which holds no workflow job source to run${params.job === undefined ? "" : ` ("${params.job}")`}.`,
    suggestion: "Pass the TypeScript source (.ts) that exports the workflow job.",
    command: "workflow run",
  });
}
