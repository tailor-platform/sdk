/**
 * Long-running migration execution via a temporary workflow
 *
 * Synchronous script execution is bound by the platform's 60s function
 * deadline. A migration marked `longRunning` is instead registered as a
 * temporary workflow and started asynchronously, so only the polling loop
 * spans the migration's real duration.
 *
 * The temporary function, job function, and workflow are removed once the
 * execution reaches a terminal state. Every resource is labeled with the app's
 * ownership immediately, so a run interrupted before teardown stays
 * attributable, and the next run of the same migration reclaims the leftovers
 * before recreating them.
 */

import * as crypto from "node:crypto";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { formatMigrationNumber } from "#/cli/commands/tailordb/migrate/snapshot";
import { isNotFoundError } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { buildMetaRequest, resourceTrn, writeMetadataLabelsDirect } from "../label";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AuthInvoker } from "@tailor-platform/tailor-proto/auth_resource_pb";
import type { CreateFunctionRegistryRequestSchema } from "@tailor-platform/tailor-proto/function_registry_pb";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

const CHUNK_SIZE = 64 * 1024;

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
    description: "Temporary function for a long-running TailorDB migration",
    sizeBytes: BigInt(buffer.length),
    contentHash: crypto.createHash("sha256").update(code, "utf-8").digest("hex"),
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
 * Remove the temporary resources created for a long-running migration.
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

/**
 * Remove any leftovers from an earlier interrupted run of this migration.
 *
 * The resource name is stable per migration and `createFunctionRegistry` is
 * create-only, so a retry would otherwise fail on a name collision. Deleting
 * first makes the create path idempotent across retries.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 */
async function reclaimLeftovers(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<void> {
  const workflowId = await findMigrationWorkflowId(client, workspaceId, name);
  await teardown(client, workspaceId, name, workflowId);
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

  let workflowId: string | undefined;
  try {
    await reclaimLeftovers(client, workspaceId, name);
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
      return { success: true, logs: await collectJobLogs(client, workspaceId, execution) };
    }
    if (execution.status === WorkflowExecution_Status.FAILED) {
      const logs = await collectJobLogs(client, workspaceId, execution);
      return {
        success: false,
        logs,
        error: extractFailureMessage(logs),
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Collect the logs of every job in a workflow execution.
 *
 * Workflow executions do not carry logs; each job's logs live on its
 * corresponding function execution.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param execution - Workflow execution to read jobs from
 * @returns Concatenated job logs
 */
async function collectJobLogs(
  client: OperatorClient,
  workspaceId: string,
  execution: WorkflowExecution,
): Promise<string> {
  const logs = await Promise.all(
    execution.jobExecutions.map(async (job) => {
      if (!job.executionId) return "";
      try {
        const { execution: functionExecution } = await client.getFunctionExecution({
          workspaceId,
          executionId: job.executionId,
        });
        return functionExecution?.logs ?? "";
      } catch {
        return "";
      }
    }),
  );
  return logs.filter(Boolean).join("\n");
}

/**
 * Derive a failure message from job logs, falling back to a generic message.
 * @param logs - Collected job logs
 * @returns Failure message
 */
function extractFailureMessage(logs: string): string {
  const lastErrorLine = logs
    .split("\n")
    .filter((line) => /error/i.test(line))
    .at(-1);
  return lastErrorLine?.trim() || "Migration workflow execution failed.";
}
