/**
 * Temporary workflow resources
 *
 * A script that outlives the platform's synchronous execution deadline runs as
 * a function registered in the registry, wrapped in a job function and a
 * workflow that is started asynchronously. These helpers create, find, poll and
 * remove such resources; callers decide what the script is and what its name,
 * labels and wording are.
 */

import * as crypto from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import { WorkflowExecution_Status } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import {
  buildMetaRequest,
  resourceTrn,
  writeMetadataLabelsDirect,
} from "#/cli/commands/deploy/label";
import { isWorkflowExecutionFailureStatus } from "#/cli/commands/workflow/status";
import { getOrNull, isNotFoundError } from "#/cli/shared/client";
import { CLIError, internalError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { isRetryableWaitError } from "#/cli/shared/wait-error";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  CreateFunctionRegistryRequestSchema,
  UpdateFunctionRegistryRequestSchema,
} from "@tailor-platform/tailor-proto/function_registry_pb";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

const CHUNK_SIZE = 64 * 1024;

/** Owning application recorded in the labels of every temporary resource. */
interface TemporaryResourceOwner {
  /** Application recorded in the labels; the resources carry no labels at all when undefined */
  owner?: { appName: string; appId: string | undefined };
}

interface LabelTemporaryResourceParams extends TemporaryResourceOwner {
  client: OperatorClient;
  trn: string;
  /** Extra labels for the resource. */
  metadata?: Record<string, string>;
}

async function labelTemporaryResource(params: LabelTemporaryResourceParams): Promise<void> {
  const { client, trn, owner, metadata } = params;
  if (!owner) return;
  await writeMetadataLabelsDirect(
    client,
    await buildMetaRequest({ trn, appName: owner.appName, appId: owner.appId, metadata }),
  );
}

export interface UploadTemporaryFunctionParams extends TemporaryResourceOwner {
  client: OperatorClient;
  workspaceId: string;
  /** Function registry name. */
  name: string;
  /** Bundled script content. */
  code: string;
  /** Registry description of the function. */
  description: string;
  /** Source placed before the script. */
  prelude?: string;
  /** Whether the function is new or replaces an existing one's content. */
  mode?: "create" | "update";
}

/**
 * Upload a bundled script to the function registry and, with an owner, label it as owned by the app.
 * @param params - Function to upload
 */
export async function uploadTemporaryFunction(
  params: UploadTemporaryFunctionParams,
): Promise<void> {
  const { client, workspaceId, name, code, description, owner, mode = "create" } = params;
  const content = `${params.prelude ?? ""}${code}`;
  const buffer = Buffer.from(content, "utf-8");
  const info = {
    workspaceId,
    name,
    description,
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
  await labelTemporaryResource({
    client,
    trn: resourceTrn(workspaceId, "function_registry", name),
    owner,
  });
}

export interface TeardownTemporaryWorkflowParams {
  client: OperatorClient;
  workspaceId: string;
  /** Shared resource name. */
  name: string;
  /** Created workflow id, when it was created. */
  workflowId: string | undefined;
  /** Job functions created under the shared name. */
  jobFunctionNames?: readonly string[];
  /** What the resources run, used in warnings (e.g. `migration`). */
  subject: string;
  /** Sentence of the warning telling how a resource left behind gets removed. */
  leftoverNote: string;
}

/**
 * Remove the temporary resources created for a run.
 *
 * Teardown is best effort: a failure here must not mask the run's own
 * outcome, so every removal is attempted and an unexpected failure is reported
 * as a warning rather than raised.
 * @param params - Resources to remove
 */
export async function teardownTemporaryWorkflow(
  params: TeardownTemporaryWorkflowParams,
): Promise<void> {
  const { client, workspaceId, name, workflowId, subject, leftoverNote } = params;
  const jobFunctionNames = params.jobFunctionNames ?? [name];
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
        `Could not remove the temporary ${subject} ${label} '${resource}': ` +
          `${error instanceof Error ? error.message : String(error)}. ${leftoverNote}`,
      );
    }
  }
}

/**
 * Find a temporary workflow by name, if it still exists.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 * @returns Workflow id, or undefined when no such workflow exists
 */
export async function findTemporaryWorkflowId(
  client: OperatorClient,
  workspaceId: string,
  name: string,
): Promise<string | undefined> {
  const response = await getOrNull(() =>
    client.getWorkflowByName({ workspaceId, workflowName: name }),
  );
  return response?.workflow?.id;
}

/**
 * List the newest executions of a temporary workflow.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param name - Shared resource name
 * @returns Executions, newest first; empty when the workflow does not exist
 */
export async function listTemporaryWorkflowExecutions(
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

/**
 * Remove any leftovers from an earlier interrupted run under the same name.
 *
 * The resource name is stable per run kind and `createFunctionRegistry` is
 * create-only, so a retry would otherwise fail on a name collision. Deleting
 * first makes the create path idempotent across retries.
 * @param params - Resources to remove
 */
export async function reclaimTemporaryWorkflow(
  params: Omit<TeardownTemporaryWorkflowParams, "workflowId">,
): Promise<void> {
  const workflowId = await findTemporaryWorkflowId(params.client, params.workspaceId, params.name);
  await teardownTemporaryWorkflow({ ...params, workflowId });
}

export interface CreateTemporaryWorkflowParams extends TemporaryResourceOwner {
  client: OperatorClient;
  workspaceId: string;
  /** Shared resource name; the workflow and its main job function use it. */
  name: string;
  /** Job functions to create on the uploaded function, the main one included. */
  jobFunctionNames: readonly string[];
  /** What the resources run, used in errors (e.g. `migration`). */
  subject: string;
  /** Extra labels for the workflow, written only with an owner. */
  workflowLabels?: Record<string, string>;
}

/** Ids of the resources {@link createTemporaryWorkflow} created, as soon as each exists. */
export interface CreatedTemporaryWorkflow {
  workflowId?: string;
}

/**
 * Create the job functions and the workflow for an uploaded function,
 * labeling each as it is created.
 * @param params - Resources to create
 * @param created - Receives the workflow id before labeling, so teardown can remove it
 * @returns Workflow id
 */
export async function createTemporaryWorkflow(
  params: CreateTemporaryWorkflowParams,
  created: CreatedTemporaryWorkflow,
): Promise<string> {
  const { client, workspaceId, name, owner, subject } = params;
  const versions: Record<string, bigint> = {};
  for (const jobFunctionName of params.jobFunctionNames) {
    const { jobFunction } = await client.createWorkflowJobFunction({
      workspaceId,
      jobFunctionName,
      scriptRef: name,
      publishExecutionEvents: false,
    });
    await labelTemporaryResource({
      client,
      trn: resourceTrn(workspaceId, "workflow_job_function", jobFunctionName),
      owner,
    });
    const version = jobFunction?.version;
    if (version === undefined) {
      throw internalError(
        `Temporary ${subject} job function '${jobFunctionName}' was created without a version.`,
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
    throw internalError(`Temporary ${subject} workflow '${name}' was created without an id.`);
  }
  created.workflowId = workflowId;
  await labelTemporaryResource({
    client,
    trn: resourceTrn(workspaceId, "workflow", name),
    owner,
    metadata: params.workflowLabels,
  });
  return workflowId;
}

export interface PollExecutionOptions {
  /** Called with each polled execution that is still active. */
  onActive?: (execution: WorkflowExecution) => void | Promise<void>;
  /** Called for each poll whose transient error was retried. */
  onPollFailed?: () => void;
}

export interface PollUntilTerminalParams {
  client: OperatorClient;
  workspaceId: string;
  executionId: string;
  /** Poll interval in milliseconds. */
  pollInterval: number;
  /** What the execution runs, used in errors (e.g. `Migration`). */
  subject: string;
  options?: PollExecutionOptions;
}

/**
 * Poll a workflow execution until it reaches a terminal state, polling through
 * transient errors.
 * @param params - Execution to poll
 * @returns The execution in its terminal state
 */
export async function pollUntilTerminal(
  params: PollUntilTerminalParams,
): Promise<WorkflowExecution> {
  const { client, workspaceId, executionId, pollInterval, subject, options = {} } = params;
  // loop exits when the workflow execution reaches a terminal status
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    let execution: WorkflowExecution | undefined;
    try {
      ({ execution } = await client.getWorkflowExecution({ workspaceId, executionId }));
    } catch (error) {
      if (!isRetryableWaitError(error)) throw error;
      options.onPollFailed?.();
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      continue;
    }
    if (!execution) {
      throw CLIError({
        code: "WORKFLOW_EXECUTION_NOT_FOUND",
        message: `${subject} workflow execution '${executionId}' not found.`,
      });
    }
    if (!isExecutionActive(execution)) return execution;
    await options.onActive?.(execution);
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

/**
 * Whether a workflow execution has not reached a terminal state.
 * @param execution - Workflow execution
 * @returns True while the execution is pending or running
 */
export function isExecutionActive(execution: WorkflowExecution): boolean {
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

/**
 * Whether a failed start was refused before the platform created an execution.
 * @param error - Error thrown by the start call
 * @returns True when no execution can exist
 */
export function isStartRefused(error: unknown): boolean {
  return error instanceof ConnectError && START_REFUSED_CODES.has(error.code);
}
