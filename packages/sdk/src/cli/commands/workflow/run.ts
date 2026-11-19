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
  reclaimFinishedWorkflowRuns,
  reclaimWorkflowRuns,
  startWorkflowRun,
  workflowRunHints,
} from "#/cli/shared/workflow-run";
import { createRunId } from "#/cli/shared/workflow-run-labels";
import { KyselyGeneratorID } from "#/plugin/builtin/kysely-type/index";
import { resolvePluginConfig } from "#/plugin/get-plugin-config";
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
  prepareFunction,
  printExecutionDetails,
} from "../function/run-function";

const CLEANUP_COMMAND = "tailor workflow run --cleanup";

export const runCommand = defineAppCommand({
  name: "run",
  description: "Run a script as a temporary workflow, past the synchronous time limit.",
  args: z.strictObject({
    ...workspaceArgs,
    file: arg(z.string().optional(), {
      positional: true,
      description: "Path to the script file (not needed with --cleanup)",
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
      description: "Maximum time to wait (e.g., '30s', '10m')",
    }),
    cleanup: arg(z.boolean().default(false), {
      description: "Remove the temporary resources of runs that have finished, then exit",
    }),
    ...configArg,
  }),
  notes: `The script runs as an asynchronous workflow job, so it is not bound by the time limit of \`function run\`. The command waits for it to finish and removes the temporary resources afterwards.

Without \`--job\`, the whole file runs: export \`main(arg)\` from a plain script, or pass a resolver, executor, or workflow job file. With \`--job\`, only the workflow job of that name runs, with \`--arg\` as its input. The argument must be a JSON object (\`null\` is accepted too): unlike \`function run\`, a number, string, boolean, or array is refused before anything is created.

When the wait stops (\`--timeout\` elapsed), the script keeps running and its temporary resources stay in place. The command prints the run ID; read the outcome with \`tailor workflow executions\`. \`${CLEANUP_COMMAND}\` removes the resources of runs that have finished, and the next \`workflow run\` does the same before it starts. A run that finished within the last few minutes is left alone by that automatic sweep (and by \`tailor deploy\`), so the command still waiting for it can read its result; \`--cleanup\` removes it at once.

> [!WARNING]
> Only the selected job is registered, so a job that starts other jobs with \`.start()\` fails at that call. Run such a workflow from its own entry point instead.`,
  examples: [
    { cmd: 'scripts/backfill.ts --arg \'{"from":"2026-01-01"}\'', desc: "Run a long script" },
    {
      cmd: 'workflows/jobs.ts --job send-report --arg \'{"id":"42"}\'',
      desc: "Run one workflow job that does not start other jobs",
    },
    { cmd: "--cleanup", desc: "Remove the resources of finished runs" },
  ],
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const pollInterval = parseDuration(args.interval);
    assertPollInterval(pollInterval);
    const { client, workspaceId } = await loadOperatorWorkspaceContext({
      profile: args.profile,
      workspaceId: args["workspace-id"],
    });

    if (args.cleanup) {
      const removed = await reclaimWorkflowRuns({
        client,
        workspaceId,
        now: new Date(),
        ignoreFinishedGrace: true,
      });
      if (logger.jsonMode) logger.out({ removed });
      else logger.success(`Removed ${removed.length} finished run(s).`);
      return;
    }

    if (!args.file) {
      throw CLIError({
        code: "WORKFLOW_RUN_FILE_REQUIRED",
        message: "A script file is required.",
        suggestion: "Pass the path of the script to run, or use --cleanup.",
        command: "workflow run",
      });
    }
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
    const target: FunctionRunTarget = {
      filePath,
      jobName: args.job,
      config,
      kyselyTemporal: resolvePluginConfig(plugins, KyselyGeneratorID)?.temporal ?? false,
      client,
      workspaceId,
      authNamespace,
      machineUser,
    };
    const prepared = await prepareFunction({ target, progress: (message) => logger.info(message) });
    assertSelectedJob({
      job: args.job,
      functionType: prepared.functionType,
      functionName: prepared.functionName,
    });

    await reclaimFinishedWorkflowRuns({ client, workspaceId, now: new Date() });

    const kind = args.job ? "job" : "script";
    const started = await startWorkflowRun({
      client,
      workspaceId,
      runId: createRunId(new Date(), crypto.randomBytes(3).toString("hex")),
      kind,
      code: prepared.bundledCode,
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
      printExecutionDetails(prepared, result);
    }
    if (!result.success) {
      // Exiting at once would cut off what is still queued for a pipe.
      await Promise.all(
        [process.stdout, process.stderr].map(
          (stream) => new Promise<void>((resolve) => stream.write("", () => resolve())),
        ),
      );
      process.exit(1);
    }
  },
});

interface SelectedJobParams {
  /** `--job` value */
  job: string | undefined;
  /** Type detected from the file; undefined for a pre-bundled `.js` file */
  functionType: string | undefined;
  /** Name detected from the file; undefined for a pre-bundled `.js` file */
  functionName: string | undefined;
}

/**
 * Refuse `--job` unless the file's detected function is that workflow job:
 * otherwise a missing job would silently run the script's own `main`.
 * @param params - `--job` and what detection found
 */
export function assertSelectedJob(params: SelectedJobParams): void {
  const { job, functionType, functionName } = params;
  if (job === undefined) return;
  if (functionType === undefined) {
    throw CLIError({
      code: "WORKFLOW_RUN_JOB_NOT_FOUND",
      message: `Workflow job "${job}" cannot be selected in a pre-bundled file.`,
      suggestion: "Pass the TypeScript source (.ts) that exports the workflow job.",
      command: "workflow run",
    });
  }
  if (functionType !== "workflow-job" || functionName !== job) {
    throw CLIError({
      code: "WORKFLOW_RUN_JOB_NOT_FOUND",
      message: `Workflow job "${job}" not found in the file.`,
      suggestion: "Export a createWorkflowJob with that name from the file, or run without --job.",
      command: "workflow run",
    });
  }
}
