/**
 * Script execution through a temporary workflow
 *
 * Synchronous script execution is bound by the platform's 60s function
 * deadline. A script that has to outlive it is registered once as a temporary
 * workflow, started once per argument, and removed when the caller is done.
 * Every start passes its argument to the job as the argument of `main`, the
 * same contract synchronous execution has.
 */

import { Code, ConnectError } from "@connectrpc/connect";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { applicationOwner, type DeployOwner } from "#/cli/commands/deploy/label";
import { recoveryContextArgs } from "#/cli/shared/args";
import { CLIError, formatCommandHint } from "#/cli/shared/errors";
import { joinFunctionLogMessages } from "#/cli/shared/function-execution";
import {
  createTemporaryWorkflow,
  isExecutionActive,
  listTemporaryWorkflowExecutions,
  pollUntilTerminal,
  reclaimTemporaryWorkflow,
  teardownTemporaryWorkflow,
  uploadTemporaryFunction,
} from "#/cli/shared/temporary-workflow";
import { isRetryableWaitError } from "#/cli/shared/wait-error";
import type { OperatorClient } from "#/cli/shared/client";
import type { ScriptExecutionResult, ScriptInvoker } from "#/cli/shared/script-executor";
import type { CreatedTemporaryWorkflow } from "#/cli/shared/temporary-workflow";
import type { FunctionExecution } from "@tailor-platform/tailor-proto/function_resource_pb";
import type {
  WorkflowExecution,
  WorkflowJobExecution,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import type { Jsonifiable } from "type-fest";

/** Poll interval while waiting for a started script to finish. */
const POLL_INTERVAL_MS = 3000;

/** Subject of the temporary resources in messages. */
const SUBJECT = "script";

/**
 * Options for {@link withScriptWorkflow}
 */
export interface ScriptWorkflowOptions {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /**
   * Name shared by the function, job function and workflow. Stable per kind of
   * run, so a retry reclaims the leftovers of an interrupted one.
   */
  name: string;
  /** Description recorded on the registered function */
  description: string;
  /** Bundled script code exporting `main` */
  code: string;
  /** Auth invoker for the script */
  invoker: ScriptInvoker;
  /**
   * Name of the owning application, recorded in the resources' labels. Omit it when a workspace
   * config owns them.
   */
  appName: string | undefined;
  /** Sentence telling how a resource left behind after a failed removal gets removed */
  leftoverNote: string;
  /** Profile the run uses, carried into the hint of a refusal so the hinted command selects it too */
  profile?: string | undefined;
  /** Poll interval in milliseconds (default: 3000ms) */
  pollIntervalMs?: number;
}

/**
 * Start the script with an argument and wait for it to finish.
 */
export type RunScript = (arg: Jsonifiable) => Promise<ScriptExecutionResult>;

/**
 * Register the script as a temporary workflow, hand `use` a function that runs
 * it once per argument, and remove the resources afterwards, whether or not
 * `use` threw.
 * @param options - Script and where to register it
 * @param use - Receives the function that starts the script
 * @returns What `use` returned
 */
export async function withScriptWorkflow<T>(
  options: ScriptWorkflowOptions,
  use: (run: RunScript) => Promise<T>,
): Promise<T> {
  const { client, workspaceId, name, appName, invoker, leftoverNote, profile } = options;
  const owner: DeployOwner =
    appName === undefined
      ? { kind: "workspace" }
      : applicationOwner({ name: appName, id: undefined });
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  await assertMachineUserExists({ client, workspaceId, invoker });
  await assertNoActiveScriptWorkflow({ client, workspaceId, names: [name], profile });
  await reclaimTemporaryWorkflow({
    client,
    workspaceId,
    name,
    subject: SUBJECT,
    leftoverNote,
  });

  const created: CreatedTemporaryWorkflow = {};
  let workflowId: string;
  try {
    await uploadTemporaryFunction({
      client,
      workspaceId,
      name,
      code: options.code,
      description: options.description,
      owner,
    });
    workflowId = await createTemporaryWorkflow(
      {
        client,
        workspaceId,
        name,
        jobFunctionNames: [name],
        owner,
        subject: SUBJECT,
      },
      created,
    );
  } catch (error) {
    await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId: created.workflowId,
      subject: SUBJECT,
      leftoverNote,
    });
    throw error;
  }

  const run: RunScript = async (arg) => {
    const { executionId } = await client.startWorkflow({
      workspaceId,
      workflowId,
      authInvoker: invoker,
      arg: JSON.stringify(arg),
    });
    const execution = await pollUntilTerminal({
      client,
      workspaceId,
      executionId,
      pollInterval,
      subject: "Script",
    });
    const { jobFunctionName: _jobFunctionName, ...outcome } = await readOutcome({
      client,
      workspaceId,
      execution,
      pollInterval,
    });
    return outcome;
  };

  try {
    return await use(run);
  } finally {
    await teardownTemporaryWorkflow({
      client,
      workspaceId,
      name,
      workflowId,
      subject: SUBJECT,
      leftoverNote,
    });
  }
}

export interface AssertMachineUserExistsParams {
  client: OperatorClient;
  workspaceId: string;
  invoker: ScriptInvoker;
}

/**
 * Fail before anything is registered when the machine user does not exist: the platform accepts the
 * start anyway and ends the execution before any job runs, which leaves no message naming the cause.
 * @param params - Machine user the script runs as
 */
export async function assertMachineUserExists(
  params: AssertMachineUserExistsParams,
): Promise<void> {
  const { client, workspaceId, invoker } = params;
  const machineUser = await client
    .getAuthMachineUser({
      workspaceId,
      authNamespace: invoker.namespace,
      name: invoker.machineUserName,
    })
    .then((response) => response.machineUser)
    .catch((error: unknown) => {
      if (error instanceof ConnectError && error.code === Code.NotFound) return undefined;
      throw error;
    });
  if (!machineUser) {
    throw CLIError({
      code: "MACHINE_USER_NOT_FOUND",
      message: `Machine user ${invoker.machineUserName} not found in the auth namespace ${invoker.namespace}.`,
    });
  }
}

/**
 * Options for {@link assertNoActiveScriptWorkflow}
 */
export interface AssertNoActiveScriptWorkflowOptions {
  /** Operator client instance */
  client: OperatorClient;
  /** Workspace ID */
  workspaceId: string;
  /** Names of the temporary workflows to check */
  names: readonly string[];
  /** Profile the run uses, carried into the hint so the hinted command selects it too */
  profile?: string | undefined;
}

/**
 * Refuse to go on while an earlier run of one of the workflows is still executing: an interrupted
 * command leaves its chunk running on the platform, and removing the workflow under it would make
 * the chunk's outcome unknowable. A caller that deletes data before it runs a script calls this
 * first, so the refusal comes before anything is deleted.
 * @param options - Workflows to check and the workspace they live in
 */
export async function assertNoActiveScriptWorkflow(
  options: AssertNoActiveScriptWorkflowOptions,
): Promise<void> {
  const { client, workspaceId, names, profile } = options;
  for (const name of names) {
    const executions = await listTemporaryWorkflowExecutions(client, workspaceId, name);
    const active = executions.find(isExecutionActive);
    if (!active) continue;

    throw CLIError({
      code: "SCRIPT_WORKFLOW_EXECUTION_ACTIVE",
      message: `The temporary workflow '${name}' still has an execution that is running (${active.id}).`,
      suggestion:
        "An earlier command that was interrupted can still be applying its chunk. " +
        `Wait for the execution to finish (${formatCommandHint({
          command: "tailor",
          args: [
            "workflow",
            "executions",
            active.id,
            ...recoveryContextArgs({ workspaceId, profile }),
          ],
        })}), then run the command again.`,
      context: { workflowName: name, executionId: active.id },
    });
  }
}

/**
 * Pick the execution of the main job out of a workflow execution's rows. A run that
 * starts other jobs also records theirs, and a wait checkpoint runs no function.
 * @param execution - Workflow execution
 * @returns Function execution id of the main job's last row, or undefined when no job was recorded
 */
export function mainJobExecutionId(execution: WorkflowExecution): string | undefined {
  const jobs = execution.jobExecutions.filter((job) => job.kind.case !== "wait");
  const main = jobs.findLast(
    (job) => (job.position?.depth ?? 0) === 0 && !job.position?.parentWorkflowJobExecutionId,
  );
  return (main ?? jobs.at(-1))?.executionId;
}

/**
 * Pick the function execution of the main job while a run is going. A main job that waits for a job
 * it started is suspended, and is later run again as a function execution of its own; the one
 * it is suspended in only holds a record of the call, so no id is given while it waits.
 * @param execution - Workflow execution that has not finished
 * @returns Function execution id of the main job as it runs, or undefined while it is suspended
 */
export function liveMainJobExecutionId(execution: WorkflowExecution): string | undefined {
  const main = execution.jobExecutions.findLast(
    (job) =>
      job.kind.case !== "wait" &&
      (job.position?.depth ?? 0) === 0 &&
      !job.position?.parentWorkflowJobExecutionId,
  );
  if (!main) return undefined;
  if (
    main.status === WorkflowJobExecution_Status.SUSPEND ||
    main.status === WorkflowJobExecution_Status.WAITING
  ) {
    return undefined;
  }
  return main.executionId;
}

function isEndedWithoutResult(status: WorkflowJobExecution_Status): boolean {
  return (
    status === WorkflowJobExecution_Status.FAILED || status === WorkflowJobExecution_Status.CANCELED
  );
}

/**
 * Tell whether a job's result is the record of a call it suspended in, not a result of its own.
 * @param result - Result text of a function execution
 * @returns True when it has the fields of that record
 */
export function isSuspendedCallRecord(result: string): boolean {
  try {
    const parsed: unknown = JSON.parse(result);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "arg_hash" in parsed &&
      "call_index" in parsed &&
      "job_name" in parsed
    );
  } catch {
    return false;
  }
}

/**
 * Pick the job whose function execution tells how a finished run ended. A run that
 * succeeded ended with its main job. In a run that failed, the main job only reports that
 * a job it started did not return, so the cause is in the deepest job that failed or was canceled.
 * @param execution - Workflow execution in a terminal state
 * @returns Function execution id of that job, or undefined when no job was recorded
 */
export function outcomeJobExecutionId(execution: WorkflowExecution): string | undefined {
  if (execution.status !== WorkflowExecution_Status.SUCCESS) {
    let deepest: WorkflowJobExecution | undefined;
    for (const job of execution.jobExecutions) {
      if (job.kind.case === "wait" || !isEndedWithoutResult(job.status)) continue;
      if (deepest === undefined || (job.position?.depth ?? 0) >= (deepest.position?.depth ?? 0)) {
        deepest = job;
      }
    }
    if (deepest) return deepest.executionId;
  }
  return mainJobExecutionId(execution);
}

/** Reads of the job's function execution tried through transient errors. */
const READ_ATTEMPTS = 3;

export interface ReadOutcomeParams {
  client: OperatorClient;
  workspaceId: string;
  /** Workflow execution in a terminal state */
  execution: WorkflowExecution;
  /** Wait between reads in milliseconds */
  pollInterval: number;
  /** Epoch milliseconds after which reading stops with an error; no limit when omitted */
  deadline?: number;
  /** Names a job function in the logs of a run that started other jobs (default: its name) */
  jobLabel?: (jobFunctionName: string) => string;
}

/** What a finished run reported, and which job it was read from. */
export interface ScriptWorkflowOutcome extends ScriptExecutionResult {
  /** Job function the result and error were read from; its bundle maps the error's stack */
  jobFunctionName?: string;
}

interface ReadJobParams {
  client: OperatorClient;
  workspaceId: string;
  executionId: string;
  pollInterval: number;
  deadline: number | undefined;
}

async function readJobExecution(params: ReadJobParams): Promise<FunctionExecution | undefined> {
  const { client, workspaceId, executionId, pollInterval, deadline } = params;
  const throwIfPastDeadline = (expired = false) => {
    if (deadline === undefined || (!expired && Date.now() < deadline)) return;
    throw CLIError({
      code: "SCRIPT_OUTCOME_READ_TIMEOUT",
      message: `Reading the result of execution '${executionId}' did not finish in time.`,
    });
  };
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
    let signal: AbortSignal | undefined;
    try {
      throwIfPastDeadline();
      const request = { workspaceId, executionId };
      if (deadline !== undefined) signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
      const { execution } = await (signal
        ? client.getFunctionExecution(request, { signal })
        : client.getFunctionExecution(request));
      return execution;
    } catch (error) {
      // The signal fires on the deadline, but its timer can run a few milliseconds ahead of the clock.
      throwIfPastDeadline(signal?.aborted);
      if (error instanceof ConnectError && error.code === Code.NotFound) return undefined;
      if (attempt === READ_ATTEMPTS || !isRetryableWaitError(error)) throw error;
      const wait =
        deadline === undefined ? pollInterval : Math.min(pollInterval, deadline - Date.now());
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return undefined;
}

/**
 * Read the logs and result of a finished run. A workflow execution carries
 * neither; both live on the function executions of its jobs, and the run's
 * outcome is lost if they cannot be read, so a transient error is retried.
 * The result and error come from the job {@link outcomeJobExecutionId} picks;
 * a run that started other jobs reports the logs of every one of them, each
 * line marked with its job, since teardown removes the workflow they could
 * otherwise be read through.
 * @param params - Execution to read the outcome of
 * @returns Result in the shape synchronous execution reports
 */
export async function readOutcome(params: ReadOutcomeParams): Promise<ScriptWorkflowOutcome> {
  const { client, workspaceId, execution, pollInterval, deadline } = params;
  const executionId = outcomeJobExecutionId(execution);
  const read = (id: string) =>
    readJobExecution({ client, workspaceId, executionId: id, pollInterval, deadline });
  const job = executionId ? await read(executionId) : undefined;
  const outcomeRow = execution.jobExecutions.find((row) => row.executionId === executionId);
  const jobFunctionName =
    outcomeRow?.kind.case === "jobFunction" ? outcomeRow.kind.value.name : undefined;

  const rows = execution.jobExecutions.filter((row) => row.kind.case !== "wait");
  let logs: string;
  if (rows.length > 1) {
    // The logs of the other jobs are a courtesy: failing to read one must not hide the outcome.
    const rowJobs = await Promise.all(
      rows.map((row) =>
        row.executionId === executionId
          ? Promise.resolve(job)
          : read(row.executionId).catch(() => undefined),
      ),
    );
    const blocks: string[] = [];
    for (const [index, row] of rows.entries()) {
      const rowJob = rowJobs[index];
      const text = rowJob ? joinFunctionLogMessages(rowJob.logEntries) : "";
      if (!text) continue;
      const name = row.kind.case === "jobFunction" ? row.kind.value.name : row.executionId;
      const label = params.jobLabel?.(name) ?? name;
      blocks.push(
        text
          .split("\n")
          .map((line) => `[${label}] ${line}`)
          .join("\n"),
      );
    }
    logs = blocks.join("\n");
  } else {
    logs = job ? joinFunctionLogMessages(job.logEntries) : "";
  }
  const result = job?.result ?? "";

  if (execution.status === WorkflowExecution_Status.SUCCESS) {
    if (!job) {
      return {
        success: false,
        logs,
        result,
        error:
          "The workflow finished, but the result of its job could not be read, so it is unknown whether the script's changes were applied",
      };
    }
    return { success: true, logs, result, jobFunctionName };
  }
  const canceled = execution.status === WorkflowExecution_Status.CANCELED;
  const error =
    job?.error?.message.trim() ||
    (isSuspendedCallRecord(result) ? "" : result.trim()) ||
    (canceled ? "Script execution was canceled" : "Script execution failed with unknown error");
  return { success: false, logs, result, error, jobFunctionName };
}
