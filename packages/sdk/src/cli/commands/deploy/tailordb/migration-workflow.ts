/**
 * Migration execution via a temporary workflow
 *
 * Synchronous script execution is bound by the platform's 60s function
 * deadline. A migration is instead registered as a temporary workflow and
 * started asynchronously, so only the polling loop spans the migration's real
 * duration.
 *
 * The temporary function, job function, and workflow are removed once the
 * execution reaches a terminal state. Every resource is labeled with the app's
 * ownership immediately, so a run interrupted before teardown stays
 * attributable, and the next run of the same migration reclaims the leftovers
 * before recreating them — or, when the interrupted run's execution is still
 * in flight on the platform, waits for that execution instead of starting the
 * script a second time.
 */

import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { formatMigrationNumber } from "#/cli/commands/tailordb/migrate/snapshot";
import { fetchAll, getOrNull, isNotFoundError } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { computeContentHash } from "../function-registry";
import { buildMetaRequest, resourceTrn, writeMetadataLabelsDirect } from "../label";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AuthInvoker } from "@tailor-platform/tailor-proto/auth_resource_pb";
import type { CreateFunctionRegistryRequestSchema } from "@tailor-platform/tailor-proto/function_registry_pb";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

const CHUNK_SIZE = 64 * 1024;

/** Execution statuses that still have an outcome ahead of them. */
const UNFINISHED_STATUSES = new Set([
  WorkflowExecution_Status.PENDING,
  WorkflowExecution_Status.PENDING_RESUME,
  WorkflowExecution_Status.PENDING_RETRY,
  WorkflowExecution_Status.RUNNING,
  WorkflowExecution_Status.WAITING,
]);

/** Poll interval while waiting for the migration workflow to finish. */
const POLL_INTERVAL_MS = 3000;

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
 * Upload the bundled migration script to the function registry.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Function registry name
 * @param code - Bundled script content
 * @param appName - Owning application name for the resource's labels
 * @param appId - Owning application id, when known
 */
async function uploadMigrationFunction(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  code: string,
  appName: string,
  appId: string | undefined,
): Promise<void> {
  const buffer = Buffer.from(code, "utf-8");
  const info = {
    workspaceId,
    name,
    description: "Temporary function for a TailorDB migration",
    sizeBytes: BigInt(buffer.length),
    contentHash: computeContentHash(code),
  };

  /** @yields {MessageInitShape<typeof CreateFunctionRegistryRequestSchema>} Info header followed by content chunks */
  async function* stream(): AsyncIterable<
    MessageInitShape<typeof CreateFunctionRegistryRequestSchema>
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

  await client.createFunctionRegistry(stream());
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
 */
async function teardown(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  workflowId: string | undefined,
): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ...(workflowId
      ? ([["workflow", () => client.deleteWorkflow({ workspaceId, workflowId })]] as [
          string,
          () => Promise<unknown>,
        ][])
      : []),
    [
      "job function",
      () => client.deleteWorkflowJobFunction({ workspaceId, jobFunctionName: name }),
    ],
    ["function", () => client.deleteFunctionRegistry({ workspaceId, name })],
  ];

  for (const [label, run] of steps) {
    try {
      await run();
    } catch (error) {
      // An already-absent resource means teardown's goal is met; anything else
      // leaves a resource behind and has to stay diagnosable.
      if (isNotFoundError(error)) continue;
      logger.warn(
        `Could not remove the temporary migration ${label} '${name}': ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          "It is labeled as owned by this app and can be removed by a later deploy.",
      );
    }
  }
}

interface AdoptedExecution {
  workflowId: string;
  result: LongRunningMigrationResult;
}

/**
 * An earlier run's execution of this migration is still in flight and cannot
 * be adopted. The earlier run's resources must stay untouched, including the
 * schema its script is running against.
 */
export class MigrationExecutionInFlightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationExecutionInFlightError";
  }
}

/**
 * Deal with the leftovers of an earlier interrupted run of this migration.
 *
 * The resource name is stable per migration and `createFunctionRegistry` is
 * create-only, so a retry would otherwise fail on a name collision. Leftovers
 * whose execution already finished are deleted so the create path stays
 * idempotent. A leftover whose execution is still in flight is adopted
 * instead: its outcome becomes this run's outcome, because deleting it would
 * not stop the script and recreating it would run the script twice.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 * @param code - Bundled script this run would execute
 * @param pollInterval - Poll interval in milliseconds
 * @returns The adopted execution's outcome, or undefined when the create path should run
 */
async function reclaimLeftovers(
  client: OperatorClient,
  workspaceId: string,
  name: string,
  code: string,
  pollInterval: number,
): Promise<AdoptedExecution | undefined> {
  const workflowId = await findMigrationWorkflowId(client, workspaceId, name);
  const [execution, ...others] = workflowId
    ? await findUnfinishedExecutions(client, workspaceId, name)
    : [];
  if (!workflowId || !execution) {
    await teardown(client, workspaceId, name, workflowId);
    return undefined;
  }

  if (others.length > 0) {
    throw new MigrationExecutionInFlightError(
      `Migration workflow '${name}' has ${others.length + 1} unfinished executions from earlier runs, so this run cannot tell which one to wait for. ` +
        "Wait for them to finish, then retry the deployment.",
    );
  }
  if (execution.status === WorkflowExecution_Status.WAITING) {
    throw new MigrationExecutionInFlightError(
      `Migration workflow '${name}' has an execution from an earlier run that is waiting to be resumed and cannot complete on its own. ` +
        "Resolve or delete that execution, then retry the deployment.",
    );
  }

  const leftover = await getOrNull(() => client.getFunctionRegistry({ workspaceId, name }));
  if (leftover?.function?.contentHash !== computeContentHash(code)) {
    throw new MigrationExecutionInFlightError(
      `Migration workflow '${name}' is still running from an earlier run, but its script could not be confirmed to match the current migrate.ts. ` +
        "Wait for it to finish, then retry the deployment.",
    );
  }

  logger.info(
    `Migration workflow '${name}' is still running from an earlier deployment; waiting for it instead of starting the script again.`,
  );
  const result = await waitForMigrationWorkflow(client, workspaceId, execution.id, pollInterval);
  return { workflowId, result };
}

/**
 * List the executions of this migration's workflow that have not finished.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 * @returns Unfinished executions
 */
async function findUnfinishedExecutions(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<WorkflowExecution[]> {
  const executions = await fetchAll(async (pageToken, pageSize) => {
    const response = await client.listWorkflowExecutions({
      workspaceId,
      workflowName: name,
      pageToken,
      pageSize,
    });
    return [response.executions, response.nextPageToken];
  });
  return executions.filter((execution) => UNFINISHED_STATUSES.has(execution.status));
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
  try {
    const { workflow } = await client.getWorkflowByName({ workspaceId, workflowName: name });
    return workflow?.id;
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
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

  const adopted = await reclaimLeftovers(client, workspaceId, name, code, pollInterval);
  let workflowId = adopted?.workflowId;
  try {
    if (adopted) return adopted.result;

    await uploadMigrationFunction(client, workspaceId, name, code, appName, appId);

    const { jobFunction } = await client.createWorkflowJobFunction({
      workspaceId,
      jobFunctionName: name,
      scriptRef: name,
      publishExecutionEvents: false,
    });
    await writeMetadataLabelsDirect(
      client,
      await buildMetaRequest({
        trn: resourceTrn(workspaceId, "workflow_job_function", name),
        appName,
        appId,
      }),
    );

    const version = jobFunction?.version;
    if (version === undefined) {
      throw new Error(`Temporary migration job function '${name}' was created without a version.`);
    }

    const { workflow } = await client.createWorkflow({
      workspaceId,
      workflowName: name,
      mainJobFunctionName: name,
      jobFunctions: { [name]: version },
    });
    workflowId = workflow?.id;
    if (!workflowId) {
      throw new Error(`Temporary migration workflow '${name}' was created without an id.`);
    }
    await writeMetadataLabelsDirect(
      client,
      await buildMetaRequest({
        trn: resourceTrn(workspaceId, "workflow", name),
        appName,
        appId,
      }),
    );

    const { executionId } = await client.startWorkflow({
      workspaceId,
      workflowId,
      authInvoker: invoker,
    });

    return await waitForMigrationWorkflow(client, workspaceId, executionId, pollInterval);
  } finally {
    await teardown(client, workspaceId, name, workflowId);
  }
}

/**
 * Poll a migration workflow execution until it reaches a terminal state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param executionId - Workflow execution id
 * @param pollInterval - Poll interval in milliseconds
 * @returns Execution result
 */
async function waitForMigrationWorkflow(
  client: OperatorClient,
  workspaceId: string,
  executionId: string,
  pollInterval: number,
): Promise<LongRunningMigrationResult> {
  // loop exits when the workflow execution reaches a terminal status
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    const { execution } = await client.getWorkflowExecution({
      workspaceId,
      executionId,
    });
    if (!execution) {
      throw new Error(`Migration workflow execution '${executionId}' not found.`);
    }

    if (execution.status === WorkflowExecution_Status.SUCCESS) {
      const { logs } = await collectJobOutcomes(client, workspaceId, execution);
      return { success: true, logs };
    }
    if (execution.status === WorkflowExecution_Status.FAILED) {
      const outcomes = await collectJobOutcomes(client, workspaceId, execution);
      return {
        success: false,
        logs: outcomes.logs,
        error: extractFailureMessage(outcomes),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Collect the logs and failure reasons of every job in a workflow execution.
 *
 * Workflow executions carry neither logs nor the error a job threw; both live
 * on the job's corresponding function execution.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param execution - Workflow execution to read jobs from
 * @returns Concatenated job logs and the reasons the jobs failed
 */
async function collectJobOutcomes(
  client: OperatorClient,
  workspaceId: string,
  execution: WorkflowExecution,
): Promise<{ logs: string; failures: string[] }> {
  const outcomes = await Promise.all(
    execution.jobExecutions.map(async (job) => {
      if (!job.executionId) return undefined;
      try {
        const { execution: functionExecution } = await client.getFunctionExecution({
          workspaceId,
          executionId: job.executionId,
        });
        if (!functionExecution) return undefined;
        // The script's own error is reported as structured error info, or as
        // the execution result; logs only carry what the script printed.
        const failure =
          functionExecution.error?.message.trim() || functionExecution.result.trim() || "";
        return { logs: functionExecution.logs, failure };
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
  };
}

/**
 * Derive a failure message from the jobs' failure reasons, falling back to the
 * last log line mentioning an error and then to a generic message.
 * @param outcomes - Collected job logs and failure reasons
 * @returns Failure message
 */
function extractFailureMessage(outcomes: { logs: string; failures: string[] }): string {
  const failure = outcomes.failures.at(-1);
  if (failure) return failure;

  const lastErrorLine = outcomes.logs
    .split("\n")
    .filter((line) => /error/i.test(line))
    .at(-1);
  return lastErrorLine?.trim() || "Migration workflow execution failed.";
}
