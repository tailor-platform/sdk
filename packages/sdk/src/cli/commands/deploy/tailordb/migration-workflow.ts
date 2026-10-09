/**
 * Migration execution via a temporary workflow
 *
 * Synchronous script execution is bound by the platform's 60s function
 * deadline. A migration is instead registered as a temporary workflow and
 * started asynchronously, so only the polling loop spans the migration's real
 * duration.
 *
 * The temporary function, job function, and workflow are removed once the
 * execution reaches a terminal state; a multi-step run keeps them until its
 * checkpoint is committed so a later deploy can resume it. Every resource is
 * labeled with the app's ownership immediately, so a run interrupted before
 * teardown stays attributable, and the next run of the same migration reclaims
 * the leftovers before recreating them.
 */

import * as crypto from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import {
  WorkflowExecution_Status,
  WorkflowJobExecution_Status,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { formatMigrationNumber } from "#/cli/commands/tailordb/migrate/snapshot";
import { isWorkflowExecutionFailureStatus } from "#/cli/commands/workflow/status";
import { getOrNull, isNotFoundError } from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import { joinFunctionLogMessages } from "#/cli/shared/function-execution";
import { logger } from "#/cli/shared/logger";
import { isRetryableWaitError } from "#/cli/shared/wait-error";
import { buildMetaRequest, resourceTrn, writeMetadataLabelsDirect } from "../label";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AuthInvoker } from "@tailor-platform/tailor-proto/auth_resource_pb";
import type {
  CreateFunctionRegistryRequestSchema,
  UpdateFunctionRegistryRequestSchema,
} from "@tailor-platform/tailor-proto/function_registry_pb";
import type {
  WorkflowExecution,
  WorkflowJobExecution,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";

const CHUNK_SIZE = 64 * 1024;

/** Poll interval while waiting for the migration workflow to finish. */
const POLL_INTERVAL_MS = 3000;

/** Rereads of a finished run's logs when the start of its script has not arrived yet. */
const START_LOG_REREADS = 2;

/**
 * Logged first by every job of a migration run. Platform statuses and start times report a job as
 * running well before its code starts, so this line is what tells that the script is running.
 */
export const MIGRATION_SCRIPT_STARTED_LOG = "[tailor-sdk] migration script started";

/** Progress of a migration run as observed while waiting for it, timed with `performance.now()`. */
export type MigrationRunEvent =
  | { type: "waiting"; at: number }
  | { type: "running"; at: number }
  | { type: "polled"; at: number; execution: WorkflowExecution }
  | { type: "finished"; at: number; scriptStarted: boolean };

export interface LongRunningMigrationOptions {
  client: OperatorClient;
  workspaceId: string;
  /** Bundled migration script exporting `main`. */
  code: string;
  namespace: string;
  migrationNumber: number;
  invoker: AuthInvoker;
  appName: string;
  appId: string | undefined;
  pollIntervalMs?: number;
  /**
   * Called when no job is running the script (`waiting`, also when waiting starts), when a job is
   * (`running`), on every poll that finds the run active, and when the run finished, with whether
   * any job was seen running the script.
   */
  onRunEvent?: (event: MigrationRunEvent) => void;
}

export interface LongRunningMigrationResult {
  success: boolean;
  logs: string;
  error?: string;
}

/**
 * Build the shared resource name for a migration's temporary workflow resources.
 * The name is stable per migration so a retry reclaims an interrupted run's
 * leftovers rather than duplicating them.
 * @param namespace - TailorDB namespace
 * @param migrationNumber - Migration number
 * @returns Resource name
 */
export function migrationWorkflowResourceName(namespace: string, migrationNumber: number): string {
  return `tailordb-migration--${namespace}--${formatMigrationNumber(migrationNumber)}`;
}

/**
 * Upload the bundled migration script to the function registry, behind a line logging
 * {@link MIGRATION_SCRIPT_STARTED_LOG}.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Function registry name
 * @param code - Bundled script content
 * @param appName - Owning application name for the resource's labels
 * @param appId - Owning application id, when known
 * @param mode - Whether the function is new or replaces an existing one's content
 */
async function uploadMigrationFunction(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  code: string,
  appName: string,
  appId: string | undefined,
  mode: "create" | "update" = "create",
): Promise<void> {
  const content = `console.log(${JSON.stringify(MIGRATION_SCRIPT_STARTED_LOG)});\n${code}`;
  const buffer = Buffer.from(content, "utf-8");
  const info = {
    workspaceId,
    name,
    description: "Temporary function for a TailorDB migration",
    sizeBytes: BigInt(buffer.length),
    contentHash: crypto.createHash("sha256").update(content, "utf-8").digest("hex"),
  };

  /** @yields {MessageInitShape<typeof CreateFunctionRegistryRequestSchema>} Info header followed by content chunks */
  async function* stream(): AsyncIterable<
    MessageInitShape<typeof CreateFunctionRegistryRequestSchema> &
      MessageInitShape<typeof UpdateFunctionRegistryRequestSchema>
  > {
    yield { payload: { case: "info" as const, value: info } };
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      yield {
        payload: {
          case: "chunk" as const,
          value: buffer.subarray(i, Math.min(i + CHUNK_SIZE, buffer.length)),
        },
      };
    }
  }

  if (mode === "create") {
    await client.createFunctionRegistry(stream());
  } else {
    await client.updateFunctionRegistry(stream());
  }
  await writeMetadataLabelsDirect(
    client,
    await buildMetaRequest({
      trn: resourceTrn(workspaceId, "function_registry", name),
      appName,
      appId,
    }),
  );
}

/**
 * Remove the temporary resources created for a migration.
 *
 * Teardown is best effort: a failure here must not mask the migration's own
 * outcome, so every removal is attempted and an unexpected failure is reported
 * as a warning rather than raised.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 * @param workflowId - Created workflow id, when it was created
 * @param jobFunctionNames - Job functions created under the shared name
 */
async function teardown(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  workflowId: string | undefined,
  jobFunctionNames: readonly string[] = [name],
): Promise<void> {
  const steps: [label: string, resource: string, run: () => Promise<unknown>][] = [];
  if (workflowId) {
    steps.push(["workflow", name, () => client.deleteWorkflow({ workspaceId, workflowId })]);
  }
  for (const jobFunctionName of jobFunctionNames) {
    steps.push([
      "job function",
      jobFunctionName,
      () => client.deleteWorkflowJobFunction({ workspaceId, jobFunctionName }),
    ]);
  }
  steps.push(["function", name, () => client.deleteFunctionRegistry({ workspaceId, name })]);

  for (const [label, resource, run] of steps) {
    try {
      await run();
    } catch (error) {
      // An already-absent resource means teardown's goal is met; anything else
      // leaves a resource behind and has to stay diagnosable.
      if (isNotFoundError(error)) continue;
      logger.warn(
        `Could not remove the temporary migration ${label} '${resource}': ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          "It is labeled as owned by this app and can be removed by a later deploy.",
      );
    }
  }
}

/**
 * Remove any leftovers from an earlier interrupted run of this migration.
 *
 * The resource name is stable per migration and `createFunctionRegistry` is
 * create-only, so a retry would otherwise fail on a name collision. Deleting
 * first makes the create path idempotent across retries.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 * @param jobFunctionNames - Job functions created under the shared name
 */
async function reclaimLeftovers(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  jobFunctionNames: readonly string[] = [name],
): Promise<void> {
  const workflowId = await findMigrationWorkflowId(client, workspaceId, name);
  await teardown(client, workspaceId, name, workflowId, jobFunctionNames);
}

/**
 * Find the temporary workflow created for this migration, if it still exists.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 * @returns Workflow id, or undefined when no such workflow exists
 */
async function findMigrationWorkflowId(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<string | undefined> {
  const response = await getOrNull(() =>
    client.getWorkflowByName({ workspaceId, workflowName: name }),
  );
  return response?.workflow?.id;
}

interface CreateMigrationWorkflowParams {
  client: OperatorClient;
  workspaceId: string;
  /** Shared resource name; the workflow and its main job function use it. */
  name: string;
  /** Job functions to create on the uploaded function, the main one included. */
  jobFunctionNames: readonly string[];
  appName: string;
  appId: string | undefined;
  /** Extra labels for the workflow. */
  workflowLabels?: Record<string, string>;
}

/** Ids of the resources {@link createMigrationWorkflow} created, as soon as each exists. */
interface CreatedMigrationWorkflow {
  workflowId?: string;
}

/**
 * Create the job functions and the workflow for an uploaded migration
 * function, labeling each as it is created.
 * @param params - Resources to create
 * @param created - Receives the workflow id before labeling, so teardown can remove it
 * @returns Workflow id
 */
async function createMigrationWorkflow(
  params: CreateMigrationWorkflowParams,
  created: CreatedMigrationWorkflow,
): Promise<string> {
  const { client, workspaceId, name, appName, appId } = params;
  const versions: Record<string, bigint> = {};
  for (const jobFunctionName of params.jobFunctionNames) {
    const { jobFunction } = await client.createWorkflowJobFunction({
      workspaceId,
      jobFunctionName,
      scriptRef: name,
      publishExecutionEvents: false,
    });
    await writeMetadataLabelsDirect(
      client,
      await buildMetaRequest({
        trn: resourceTrn(workspaceId, "workflow_job_function", jobFunctionName),
        appName,
        appId,
      }),
    );
    const version = jobFunction?.version;
    if (version === undefined) {
      throw internalError(
        `Temporary migration job function '${jobFunctionName}' was created without a version.`,
      );
    }
    versions[jobFunctionName] = version;
  }

  const { workflow } = await client.createWorkflow({
    workspaceId,
    workflowName: name,
    mainJobFunctionName: name,
    jobFunctions: versions,
  });
  const workflowId = workflow?.id;
  if (!workflowId) {
    throw internalError(`Temporary migration workflow '${name}' was created without an id.`);
  }
  created.workflowId = workflowId;
  await writeMetadataLabelsDirect(
    client,
    await buildMetaRequest({
      trn: resourceTrn(workspaceId, "workflow", name),
      appName,
      appId,
      ...(params.workflowLabels ? { metadata: params.workflowLabels } : {}),
    }),
  );
  return workflowId;
}

/**
 * Execute a migration script as a temporary workflow and wait for completion.
 *
 * Unlike synchronous script execution, only the start call is bound by the
 * request deadline; the migration itself runs as a workflow job.
 * @param {LongRunningMigrationOptions} options - Execution options
 * @returns {Promise<LongRunningMigrationResult>} Execution result
 */
export async function executeMigrationAsWorkflow(
  options: LongRunningMigrationOptions,
): Promise<LongRunningMigrationResult> {
  const { client, workspaceId, code, namespace, migrationNumber, invoker, appName, appId } =
    options;
  const name = migrationWorkflowResourceName(namespace, migrationNumber);
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  const created: CreatedMigrationWorkflow = {};
  try {
    await reclaimLeftovers(client, workspaceId, name);
    await uploadMigrationFunction(client, workspaceId, name, code, appName, appId);
    const workflowId = await createMigrationWorkflow(
      { client, workspaceId, name, jobFunctionNames: [name], appName, appId },
      created,
    );

    const executionId = await startMigrationExecution({
      client,
      workspaceId,
      name,
      workflowId,
      invoker,
      pollInterval,
    });

    return await waitForMigrationWorkflow(options, executionId);
  } finally {
    await teardown(client, workspaceId, name, created.workflowId);
  }
}

interface PollExecutionOptions {
  /** Keep polling through transient errors instead of failing on the first one. */
  retryTransientErrors: boolean;
  /** Called with each polled execution that is still active. */
  onActive?: (execution: WorkflowExecution) => void | Promise<void>;
}

/**
 * Poll a migration workflow execution until it reaches a terminal state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param executionId - Workflow execution id
 * @param pollInterval - Poll interval in milliseconds
 * @param options - Retry and progress options
 * @returns The execution in its terminal state
 */
async function pollUntilTerminal(
  client: OperatorClient,
  workspaceId: string,
  executionId: string,
  pollInterval: number,
  options: PollExecutionOptions,
): Promise<WorkflowExecution> {
  // loop exits when the workflow execution reaches a terminal status
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    let execution: WorkflowExecution | undefined;
    try {
      ({ execution } = await client.getWorkflowExecution({ workspaceId, executionId }));
    } catch (error) {
      if (!options.retryTransientErrors || !isRetryableWaitError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }
    if (!execution) {
      throw CLIError({
        code: "WORKFLOW_EXECUTION_NOT_FOUND",
        message: `Migration workflow execution '${executionId}' not found.`,
      });
    }
    if (!isExecutionActive(execution)) return execution;
    await options.onActive?.(execution);
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

type ObserveRunParams = CollectJobOutcomesOptions & PollExecutionOptions;

/**
 * Whether a function execution has logged {@link MIGRATION_SCRIPT_STARTED_LOG}. A failed read
 * counts as not yet, so observing a run never fails it.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param executionId - Function execution id
 * @returns Whether the start was logged
 */
async function hasLoggedScriptStart(
  client: OperatorClient,
  workspaceId: string,
  executionId: string,
): Promise<boolean> {
  try {
    const { execution } = await client.getFunctionExecution({ workspaceId, executionId });
    return (
      execution?.logEntries.some((entry) => entry.message === MIGRATION_SCRIPT_STARTED_LOG) ?? false
    );
  } catch (error) {
    logger.debug(
      `Could not read the logs of migration job execution '${executionId}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * Wait for a migration run to finish, reporting through `onRunEvent` whether a job is running the
 * script, and collect its jobs' outcomes.
 * @param options - Execution options
 * @param executionId - Workflow execution id
 * @param params - How to poll the run and read its jobs
 * @returns The execution in its terminal state and its jobs' outcomes
 */
async function observeRun(
  options: LongRunningMigrationOptions,
  executionId: string,
  params: ObserveRunParams,
): Promise<{ execution: WorkflowExecution; outcomes: JobOutcomes }> {
  const { client, workspaceId, onRunEvent } = options;
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const started = new Set<string>();
  let running = false;
  onRunEvent?.({ type: "waiting", at: performance.now() });

  const execution = await pollUntilTerminal(client, workspaceId, executionId, pollInterval, {
    retryTransientErrors: params.retryTransientErrors,
    onActive: async (active) => {
      let nowRunning = false;
      for (const job of active.jobExecutions) {
        const id = job.executionId;
        if (job.status !== WorkflowJobExecution_Status.RUNNING || !id || !params.runsScript(job)) {
          continue;
        }
        if (!started.has(id) && (await hasLoggedScriptStart(client, workspaceId, id))) {
          started.add(id);
        }
        if (started.has(id)) {
          nowRunning = true;
          break;
        }
      }
      if (nowRunning !== running) {
        running = nowRunning;
        onRunEvent?.({ type: running ? "running" : "waiting", at: performance.now() });
      }
      onRunEvent?.({ type: "polled", at: performance.now(), execution: active });
      await params.onActive?.(active);
    },
  });
  const finishedAt = performance.now();

  let outcomes = await collectJobOutcomes(client, workspaceId, execution, params);
  const startLogPending = () =>
    started.size === 0 &&
    !outcomes.scriptStarted &&
    execution.status === WorkflowExecution_Status.SUCCESS;
  for (let reread = 0; reread < START_LOG_REREADS && startLogPending(); reread++) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, 1000)));
    outcomes = await collectJobOutcomes(client, workspaceId, execution, params);
  }
  onRunEvent?.({
    type: "finished",
    at: finishedAt,
    scriptStarted: started.size > 0 || outcomes.scriptStarted,
  });
  return { execution, outcomes };
}

/**
 * Wait for a migration workflow execution to finish and report its result.
 * @param options - Execution options
 * @param executionId - Workflow execution id
 * @returns Execution result
 */
async function waitForMigrationWorkflow(
  options: LongRunningMigrationOptions,
  executionId: string,
): Promise<LongRunningMigrationResult> {
  const { execution, outcomes } = await observeRun(options, executionId, {
    retryTransientErrors: false,
    runsScript: () => true,
  });
  if (execution.status === WorkflowExecution_Status.SUCCESS) {
    return { success: true, logs: outcomes.logs };
  }
  if (execution.status === WorkflowExecution_Status.CANCELED) {
    return {
      success: false,
      logs: outcomes.logs,
      error: "Migration workflow execution was canceled.",
    };
  }
  return { success: false, logs: outcomes.logs, error: extractFailureMessage(outcomes) };
}

interface JobOutcomes {
  logs: string;
  failures: string[];
  /** Whether a job running the script logged {@link MIGRATION_SCRIPT_STARTED_LOG}. */
  scriptStarted: boolean;
}

interface CollectJobOutcomesOptions {
  /** Prefix for a job's log lines, e.g. the step it ran. */
  labelJob?: (job: WorkflowJobExecution) => string | undefined;
  /** Whether a job's error or result can explain the failure. */
  reportsFailure?: (job: WorkflowJobExecution) => boolean;
  /** Whether a job runs the migration script itself, as opposed to orchestrating it. */
  runsScript: (job: WorkflowJobExecution) => boolean;
}

/**
 * Collect the logs and failure reasons of every job in a workflow execution.
 *
 * Workflow executions carry neither logs nor the error a job threw; both live
 * on the job's corresponding function execution.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param execution - Workflow execution to read jobs from
 * @param options - How to label and judge each job
 * @returns Concatenated job logs, the reasons the jobs failed, and whether the script started
 */
async function collectJobOutcomes(
  client: OperatorClient,
  workspaceId: string,
  execution: WorkflowExecution,
  options: CollectJobOutcomesOptions,
): Promise<JobOutcomes> {
  const { labelJob = () => undefined, reportsFailure = () => true, runsScript } = options;
  const outcomes = await Promise.all(
    execution.jobExecutions.map(async (job) => {
      const label = labelJob(job);
      if (!job.executionId) return undefined;
      try {
        const { execution: functionExecution } = await client.getFunctionExecution({
          workspaceId,
          executionId: job.executionId,
        });
        if (!functionExecution) return undefined;
        // The script's own error is reported as structured error info, or as
        // the execution result; logs only carry what the script printed.
        const failure = reportsFailure(job)
          ? functionExecution.error?.message.trim() || functionExecution.result.trim() || ""
          : "";
        const scriptEntries = functionExecution.logEntries.filter(
          (entry) => entry.message !== MIGRATION_SCRIPT_STARTED_LOG,
        );
        const logs = joinFunctionLogMessages(scriptEntries);
        return {
          logs: label && logs ? prefixLines(logs, `[${label}] `) : logs,
          failure,
          scriptStarted:
            runsScript(job) && scriptEntries.length < functionExecution.logEntries.length,
        };
      } catch {
        return undefined;
      }
    }),
  );

  return {
    logs: outcomes
      .map((outcome) => outcome?.logs)
      .filter(Boolean)
      .join("\n"),
    failures: outcomes
      .map((outcome) => outcome?.failure)
      .filter((failure): failure is string => !!failure),
    scriptStarted: outcomes.some((outcome) => outcome?.scriptStarted),
  };
}

/**
 * Derive a failure message from the jobs' failure reasons, falling back to the
 * last log line mentioning an error and then to a generic message.
 * @param outcomes - Collected job logs and failure reasons
 * @returns Failure message
 */
function extractFailureMessage(outcomes: JobOutcomes): string {
  const failure = outcomes.failures.at(-1);
  if (failure) return failure;

  const lastErrorLine = outcomes.logs
    .split("\n")
    .filter((line) => /error/i.test(line))
    .at(-1);
  return lastErrorLine?.trim() || "Migration workflow execution failed.";
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** Label recording which step plan a temporary migration workflow was created for. */
const MIGRATION_PLAN_LABEL_KEY = "sdk-migration-plan";

function isExecutionActive(execution: WorkflowExecution): boolean {
  return (
    execution.status !== WorkflowExecution_Status.SUCCESS &&
    !isWorkflowExecutionFailureStatus(execution.status)
  );
}

/** Codes the platform returns for a start before it creates the execution. */
const START_REFUSED_CODES: ReadonlySet<Code> = new Set([
  Code.InvalidArgument,
  Code.NotFound,
  Code.PermissionDenied,
  Code.Unauthenticated,
]);

function isStartRefused(error: unknown): boolean {
  return error instanceof ConnectError && START_REFUSED_CODES.has(error.code);
}

interface StartMigrationExecutionParams {
  client: OperatorClient;
  workspaceId: string;
  name: string;
  workflowId: string;
  invoker: LongRunningMigrationOptions["invoker"];
  pollInterval: number;
}

const START_LOOKUP_ATTEMPTS = 5;

async function listExecutionsAfterAmbiguousStart(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  pollInterval: number,
): Promise<WorkflowExecution[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await listMigrationExecutions(client, workspaceId, name);
    } catch (error) {
      if (attempt >= START_LOOKUP_ATTEMPTS || isStartRefused(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
  }
}

/**
 * Start the migration workflow. A start whose response is lost may still have
 * created its execution, so the executions that did not exist before the start
 * are checked before the failure is reported. The check is a read, so it is
 * retried through transient errors before it gives up.
 * @param params - Workflow to start and the executions to compare against
 * @returns Id of the execution that runs the migration
 */
async function startMigrationExecution(params: StartMigrationExecutionParams): Promise<string> {
  const { client, workspaceId, name, workflowId, invoker, pollInterval } = params;
  const known = new Set(
    (await listMigrationExecutions(client, workspaceId, name)).map((execution) => execution.id),
  );
  try {
    const { executionId } = await client.startWorkflow({
      workspaceId,
      workflowId,
      authInvoker: invoker,
    });
    return executionId;
  } catch (error) {
    if (isStartRefused(error)) throw error;
    const started = (
      await listExecutionsAfterAmbiguousStart(client, workspaceId, name, pollInterval)
    ).find((execution) => !known.has(execution.id));
    if (!started) throw error;
    logger.debug(
      `Start of migration workflow '${name}' failed (${error instanceof Error ? error.message : String(error)}), ` +
        `but execution '${started.id}' was created; waiting for it.`,
    );
    return started.id;
  }
}

/**
 * Name of the job function that runs one step of a multi-step migration.
 * @param name - Shared resource name of the migration
 * @returns Runner job function name
 */
export function migrationStepRunnerName(name: string): string {
  return `${name}--step`;
}

/**
 * Identify a step plan, so a failed run is only resumed by a deploy that
 * would start the steps in the same order.
 * @param order - Step names in execution order
 * @returns Label-safe fingerprint
 */
export function migrationPlanFingerprint(order: readonly string[]): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify(order), "utf-8").digest("hex");
  return `p${hash.slice(0, 40)}`;
}

export interface MigrationStepsWorkflowOptions extends LongRunningMigrationOptions {
  /** Step names in execution order. */
  order: readonly string[];
  /**
   * Set when an earlier deploy left this migration partially applied; holds
   * the execution it recorded, when it got that far.
   */
  inProgress?: { executionId?: string };
  /** Called once no other execution of the migration is active, before a new one is created. */
  onBeforeStart: () => Promise<void>;
  /** Called as soon as a new execution exists, before waiting on it. */
  onExecutionStarted: (executionId: string) => Promise<void>;
  /** Reports what happens to an earlier run. */
  notify: (level: "info" | "warn", message: string) => void;
  /** Called while waiting, with the number of steps that have completed. */
  onProgress?: (completedSteps: number, totalSteps: number) => void;
}

export interface MigrationStepsWorkflowResult {
  success: boolean;
  logs: string;
  error?: string;
  executionId?: string;
  completedSteps: string[];
  failedSteps: string[];
  /** Whether any step may have committed: a job succeeded, or the outcome could not be observed. */
  stepsMayHaveCommitted: boolean;
}

interface StepOutcome {
  completed: string[];
  failed: string[];
}

function classifySteps(
  execution: WorkflowExecution,
  runnerName: string,
  order: readonly string[],
): StepOutcome {
  const statuses = new Map<number, Set<WorkflowJobExecution_Status>>();
  for (const job of execution.jobExecutions) {
    if (job.kind.case !== "jobFunction" || job.kind.value.name !== runnerName) continue;
    const index = job.position?.callIndex;
    if (index === undefined) continue;
    const seen = statuses.get(index) ?? new Set();
    seen.add(job.status);
    statuses.set(index, seen);
  }
  const completed = order.filter((_, index) =>
    statuses.get(index)?.has(WorkflowJobExecution_Status.SUCCESS),
  );
  const failed = order.filter((step, index) => {
    const seen = statuses.get(index);
    return (
      !completed.includes(step) &&
      (seen?.has(WorkflowJobExecution_Status.FAILED) ||
        seen?.has(WorkflowJobExecution_Status.CANCELED))
    );
  });
  return { completed, failed };
}

async function listMigrationExecutions(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<WorkflowExecution[]> {
  const response = await getOrNull(() =>
    client.listWorkflowExecutions({
      workspaceId,
      workflowName: name,
      pageSize: 20,
      pageDirection: PageDirection.DESC,
    }),
  );
  return response?.executions ?? [];
}

async function assertNoActiveExecution(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  migrationLabel: string,
): Promise<void> {
  const active = (await listMigrationExecutions(client, workspaceId, name)).find(isExecutionActive);
  if (active) {
    throw CLIError({
      code: "MIGRATION_EXECUTION_ACTIVE",
      message: `Migration ${migrationLabel} has an execution that is still running (${active.id}).`,
      suggestion:
        "Wait for it to finish, or check that no other deploy is running against this workspace, then deploy again.",
      context: { executionId: active.id },
    });
  }
}

async function findRecordedExecution(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  executionId: string | undefined,
): Promise<WorkflowExecution | undefined> {
  if (executionId === undefined) {
    return (await listMigrationExecutions(client, workspaceId, name))[0];
  }
  const response = await getOrNull(() => client.getWorkflowExecution({ workspaceId, executionId }));
  return response?.execution;
}

async function readWorkflowPlan(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<string | undefined> {
  const response = await getOrNull(() =>
    client.getMetadata({ trn: resourceTrn(workspaceId, "workflow", name) }),
  );
  return response?.metadata?.labels[MIGRATION_PLAN_LABEL_KEY];
}

function stepJobOptions(
  runnerName: string,
  order: readonly string[],
): Required<CollectJobOutcomesOptions> {
  const runsScript = (job: WorkflowJobExecution) =>
    job.kind.case === "jobFunction" && job.kind.value.name === runnerName;
  return {
    runsScript,
    labelJob: (job) => {
      if (!runsScript(job)) return undefined;
      const index = job.position?.callIndex;
      return index === undefined ? undefined : order[index];
    },
    reportsFailure: (job) =>
      job.status === WorkflowJobExecution_Status.FAILED ||
      job.status === WorkflowJobExecution_Status.CANCELED,
  };
}

async function summarizeSteps(
  client: OperatorClient,
  workspaceId: string,
  execution: WorkflowExecution,
  runnerName: string,
  order: readonly string[],
  outcomes?: JobOutcomes,
): Promise<MigrationStepsWorkflowResult> {
  const steps = classifySteps(execution, runnerName, order);
  const jobOutcomes =
    outcomes ??
    (await collectJobOutcomes(client, workspaceId, execution, stepJobOptions(runnerName, order)));
  const base = {
    logs: jobOutcomes.logs,
    executionId: execution.id,
    completedSteps: steps.completed,
    failedSteps: steps.failed,
    stepsMayHaveCommitted: execution.jobExecutions.some(
      (job) => job.status === WorkflowJobExecution_Status.SUCCESS,
    ),
  };
  if (execution.status === WorkflowExecution_Status.SUCCESS) return { success: true, ...base };
  const error =
    execution.status === WorkflowExecution_Status.CANCELED
      ? "Migration workflow execution was canceled."
      : extractFailureMessage(jobOutcomes);
  return { success: false, error, ...base };
}

async function waitForSteps(
  options: MigrationStepsWorkflowOptions,
  executionId: string,
): Promise<MigrationStepsWorkflowResult> {
  const { client, workspaceId, order } = options;
  const runnerName = migrationStepRunnerName(
    migrationWorkflowResourceName(options.namespace, options.migrationNumber),
  );
  try {
    const { execution, outcomes } = await observeRun(options, executionId, {
      ...stepJobOptions(runnerName, order),
      retryTransientErrors: true,
      onActive: (active) =>
        options.onProgress?.(
          classifySteps(active, runnerName, order).completed.length,
          order.length,
        ),
    });
    return await summarizeSteps(client, workspaceId, execution, runnerName, order, outcomes);
  } catch (error) {
    return {
      success: false,
      logs: "",
      error: `Lost track of migration workflow execution '${executionId}': ${
        error instanceof Error ? error.message : String(error)
      }`,
      executionId,
      completedSteps: [],
      failedSteps: [],
      stepsMayHaveCommitted: true,
    };
  }
}

/**
 * Execute a multi-step migration as a temporary workflow and wait for it.
 *
 * Each step commits separately, so the temporary resources outlive a failed
 * run: the next deploy resumes that run from its failed step. They are only
 * removed here when nothing ran; otherwise the caller removes them once the
 * migration's checkpoint is committed.
 * @param options - Execution options
 * @returns Execution result with per-step outcomes
 */
export async function executeMigrationStepsAsWorkflow(
  options: MigrationStepsWorkflowOptions,
): Promise<MigrationStepsWorkflowResult> {
  const { client, workspaceId, code, namespace, migrationNumber, invoker, appName, appId, order } =
    options;
  const name = migrationWorkflowResourceName(namespace, migrationNumber);
  const runnerName = migrationStepRunnerName(name);
  const jobFunctionNames = [runnerName, name];
  const migrationLabel = `${namespace}/${formatMigrationNumber(migrationNumber)}`;
  const plan = migrationPlanFingerprint(order);
  const { notify } = options;

  if (options.inProgress) {
    const execution = await findRecordedExecution(
      client,
      workspaceId,
      name,
      options.inProgress.executionId,
    );
    const workflowId = await findMigrationWorkflowId(client, workspaceId, name);
    const planUnchanged =
      workflowId !== undefined && (await readWorkflowPlan(client, workspaceId, name)) === plan;
    if (execution && isExecutionActive(execution)) {
      notify(
        "info",
        `Migration ${migrationLabel} is still running from an earlier deploy; waiting.`,
      );
      const earlier = await waitForSteps(options, execution.id);
      if (planUnchanged) return earlier;
    } else if (execution?.status === WorkflowExecution_Status.SUCCESS && planUnchanged) {
      return await summarizeSteps(client, workspaceId, execution, runnerName, order);
    }
    if (execution?.status === WorkflowExecution_Status.FAILED && planUnchanged) {
      await uploadMigrationFunction(client, workspaceId, name, code, appName, appId, "update");
      await client.resumeWorkflowExecution({ workspaceId, executionId: execution.id });
      notify(
        "info",
        `Resuming migration ${migrationLabel} from the steps that have not completed.`,
      );
      return await waitForSteps(options, execution.id);
    }
    const reason =
      !execution || workflowId === undefined
        ? "its earlier run is no longer available"
        : execution.status === WorkflowExecution_Status.CANCELED
          ? "its earlier run was canceled"
          : "its steps changed since its earlier run";
    notify(
      "warn",
      `Migration ${migrationLabel} cannot be resumed because ${reason}; every step runs again.`,
    );
  }

  await assertNoActiveExecution(client, workspaceId, name, migrationLabel);
  await options.onBeforeStart();
  await reclaimLeftovers(client, workspaceId, name, jobFunctionNames);

  const created: CreatedMigrationWorkflow = {};
  let workflowId: string;
  try {
    await uploadMigrationFunction(client, workspaceId, name, code, appName, appId);
    workflowId = await createMigrationWorkflow(
      {
        client,
        workspaceId,
        name,
        jobFunctionNames,
        appName,
        appId,
        workflowLabels: { [MIGRATION_PLAN_LABEL_KEY]: plan },
      },
      created,
    );
  } catch (error) {
    await teardown(client, workspaceId, name, created.workflowId, jobFunctionNames);
    throw error;
  }

  let executionId: string;
  try {
    ({ executionId } = await client.startWorkflow({
      workspaceId,
      workflowId,
      authInvoker: invoker,
    }));
  } catch (error) {
    if (!isStartRefused(error)) {
      throw CLIError({
        code: "MIGRATION_START_UNCONFIRMED",
        message: `Could not confirm whether migration ${migrationLabel} started: ${
          error instanceof Error ? error.message : String(error)
        }`,
        suggestion:
          "Deploy again; the next deploy checks whether the migration started and continues from what it finds.",
        cause: error,
      });
    }
    await teardown(client, workspaceId, name, workflowId, jobFunctionNames);
    throw error;
  }

  await options.onExecutionStarted(executionId);
  const result = await waitForSteps(options, executionId);
  if (!result.success && !result.stepsMayHaveCommitted && !options.inProgress) {
    await teardown(client, workspaceId, name, created.workflowId, jobFunctionNames);
  }
  return result;
}

/**
 * Remove the temporary resources of a multi-step migration once its
 * checkpoint is committed. Best effort, like the teardown after a run.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param namespace - TailorDB namespace
 * @param migrationNumber - Migration number
 */
export async function removeMigrationWorkflowResources(
  client: OperatorClient,
  workspaceId: string,
  namespace: string,
  migrationNumber: number,
): Promise<void> {
  const name = migrationWorkflowResourceName(namespace, migrationNumber);
  await reclaimLeftovers(client, workspaceId, name, [name, migrationStepRunnerName(name)]);
}
