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
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { assertWritable } from "#/cli/shared/readonly-guard";
import {
  assertPollInterval,
  assertWorkflowArg,
  awaitWorkflowRun,
  cleanupHint,
  reclaimFinishedWorkflowRuns,
  startWorkflowRun,
  workflowRunHints,
} from "#/cli/shared/workflow-run";
import { createRunId, workflowRunJobFunctionName } from "#/cli/shared/workflow-run-labels";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
import { assertDefined } from "#/utils/assert";
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
  prepareFunction,
  printExecutionDetails,
} from "../function/run-function";
import { checkScriptSchemaSnapshot } from "../function/script-scaffold";
import { bundleWorkflowRunJobs } from "./run-jobs";

const CLEANUP_COMMAND = "tailor workflow cleanup";

export const runCommand = defineAppCommand({
  name: "run",
  description: "Run a script as a temporary workflow, past the synchronous time limit.",
  args: z.strictObject({
    ...workspaceArgs,
    file: arg(z.string(), {
      positional: true,
      description: "Path to the script file",
    }),
    job: arg(z.string().optional(), {
      description: "Workflow job name to run (matches the `name` field of createWorkflowJob)",
    }),
    arg: arg(z.string().optional(), {
      alias: "a",
      description: "JSON object to pass to the script as its argument",
    }),
    "arg-file": arg(z.string().optional(), {
      description: "Path to a JSON file holding the object to pass to the script as its argument",
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
    timeout: arg(durationArg.default("10m"), {
      alias: "t",
      description:
        "Maximum time to wait for the script, not a limit on its run (e.g., '30s', '10m')",
    }),
    "allow-schema-drift": arg(z.boolean().default(false), {
      description: "Run a scaffolded script even when its schema snapshot no longer matches",
    }),
    ...configArg,
  }),
  notes: `The script runs as an asynchronous workflow job, so it is not bound by the time limit of \`function run\`. The command waits for it to finish and removes the temporary resources afterwards.

\`--timeout\` limits how long this command waits, not how long the script may run. The Platform ends a workflow job that runs longer than 5 minutes and the run is reported as failed with a timeout error; a script that needs longer has to be split so that it can be run again from where it stopped. \`tailor workflow script\` scaffolds such a script.

Without \`--job\`, the whole file runs: export \`main(arg)\` from a plain script, or pass a resolver, executor, or workflow job file. With \`--job\`, the workflow job of that name runs as the first job of the temporary workflow, with \`--arg\` as its input. A job it starts with \`.start()\` is registered with it, so those calls work; they run the jobs of your files, not the ones already deployed under the same names. The argument must be a JSON object (\`null\` is accepted too): unlike \`function run\`, a number, string, boolean, or array is refused before anything is created.

A script scaffolded by \`function script\` with a generated \`db.ts\` is checked against its \`db.snapshot.json\` before it runs and refused on schema drift, as with \`function run\`; pass \`--allow-schema-drift\` to run it anyway.

When the wait stops (\`--timeout\` elapsed), the script keeps running and its temporary resources stay in place. The command prints the run ID; read the outcome with \`tailor workflow executions\`. \`${CLEANUP_COMMAND}\` removes the resources of runs that have finished, and the next \`workflow run\` does the same before it starts. A run that finished within the last few minutes is left alone by that automatic sweep (and by \`tailor deploy\`), so the command still waiting for it can read its result; \`${CLEANUP_COMMAND}\` removes it at once.`,
  examples: [
    { cmd: 'scripts/backfill.ts --arg \'{"from":"2026-01-01"}\'', desc: "Run a long script" },
    {
      cmd: 'workflows/jobs.ts --job send-report --arg \'{"id":"42"}\'',
      desc: "Run one workflow job together with the jobs it starts",
    },
  ],
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const pollInterval = parseDuration(args.interval);
    assertPollInterval(pollInterval);
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
    await checkScriptSchemaSnapshot({
      filePath,
      allowDrift: args["allow-schema-drift"],
      client,
      workspaceId,
      config,
      configArgValue: args.config,
      scriptArgValue: args.file,
      ...(args.profile === undefined ? {} : { profileArgValue: args.profile }),
      runCommand: ["workflow", "run"],
    });
    const target: FunctionRunTarget = {
      filePath,
      jobName: args.job,
      jobFlag: "--job",
      config,
      kyselyTemporal: resolvePluginConfig(plugins, KyselyGeneratorID)?.temporal ?? false,
      client,
      workspaceId,
      authNamespace,
      machineUser,
    };
    const runId = createRunId(new Date(), crypto.randomBytes(3).toString("hex"));
    const progress = (message: string) => logger.info(message);
    let prepared: PreparedFunction;
    let source: RunSource;
    if (args.job === undefined) {
      prepared = await prepareFunction({ target, progress });
      source = { kind: "script", code: prepared.bundledCode };
    } else {
      assertJobSource({ filePath, job: args.job });
      progress(`Bundling job "${args.job}" with the jobs it starts...`);
      const bundled = await bundleWorkflowRunJobs({ target, runId, jobName: args.job });
      const main = assertDefined(
        bundled.jobs.find((job) => job.jobName === bundled.mainJobName),
        "main job missing from the bundle",
      );
      prepared = {
        scriptName: workflowRunJobFunctionName(runId, main.jobName),
        bundledCode: main.code,
        functionType: "workflow-job",
        functionName: main.jobName,
        acceptsArg: true,
        sourceFiles: [filePath],
      };
      source = { kind: "job", mainJobName: bundled.mainJobName, jobs: bundled.jobs };
    }

    const swept = await reclaimFinishedWorkflowRuns({ client, workspaceId, now: new Date() });
    if (swept && swept.keptUnlabeled.length > 0) {
      logger.warn(
        `${swept.keptUnlabeled.length} resource(s) named \`tmp-run-…\` carry no \`workflow run\` label and were left in place. ` +
          `If they are leftovers of an interrupted run, ${cleanupHint({ workspaceId, profile: args.profile, includeUnlabeled: true })} removes them.`,
      );
    }

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
        `Stopped waiting. Run ${started.runId} keeps running; read it with ${hints.inspect}, then ${hints.cleanup}.`,
      );
      process.exit(130);
    };
    process.once("SIGINT", onInterrupt);
    const outcome = await awaitWorkflowRun({
      client,
      workspaceId,
      started,
      pollInterval,
      timeoutMs: parseDuration(args.timeout),
    }).finally(() => process.off("SIGINT", onInterrupt));

    if (outcome.state === "timedOut") {
      throw CLIError({
        code: "WORKFLOW_RUN_WAIT_TIMEOUT",
        message: `Stopped waiting for run ${started.runId}; the script is still running.`,
        suggestion: `Read the outcome with ${hints.inspect}. Afterwards, ${hints.cleanup} removes the temporary resources.`,
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
          ? "The script itself runs to its end, but its execution can no longer be read through the workflow."
          : `Read it with ${hints.inspect}. Afterwards, ${hints.cleanup} removes the temporary resources.`,
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

type RunSource =
  | { kind: "script"; code: string }
  | { kind: "job"; mainJobName: string; jobs: Array<{ jobName: string; code: string }> };

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
  if (params.source.kind !== "job") return params.fallback;
  const match = params.source.jobs.find(
    (job) => workflowRunJobFunctionName(params.runId, job.jobName) === params.jobFunctionName,
  );
  return match?.code ?? params.fallback;
}

interface JobSourceParams {
  /** Absolute path of the file */
  filePath: string;
  /** `--job` value */
  job: string;
}

/**
 * Refuse `--job` for a pre-bundled file, which holds no workflow job to choose from.
 * @param params - File and `--job`
 */
export function assertJobSource(params: JobSourceParams): void {
  if (!params.filePath.endsWith(".js")) return;
  throw CLIError({
    code: "WORKFLOW_RUN_JOB_NOT_FOUND",
    message: `Workflow job "${params.job}" cannot be selected in a pre-bundled file.`,
    suggestion: "Pass the TypeScript source (.ts) that exports the workflow job.",
    command: "workflow run",
  });
}
