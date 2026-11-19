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
import type { MetadataLabelWrite } from "#/cli/commands/deploy/label";
import type { OperatorClient } from "#/cli/shared/client";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  CreateFunctionRegistryRequestSchema,
  UpdateFunctionRegistryRequestSchema,
} from "@tailor-platform/tailor-proto/function_registry_pb";
import type { WorkflowExecution } from "@tailor-platform/tailor-proto/workflow_resource_pb";

const CHUNK_SIZE = 64 * 1024;

/**
 * Owning application recorded in the labels of every temporary resource. With no
 * `appName` the resources carry only `labels`, so a deploy never claims them.
 */
interface TemporaryResourceOwner {
  appName: string | undefined;
  appId: string | undefined;
  /** Labels written to every resource besides the owner's. */
  labels?: Record<string, string>;
}

async function temporaryLabelWrite(
  owner: TemporaryResourceOwner,
  trn: string,
  extraLabels?: Record<string, string>,
): Promise<MetadataLabelWrite> {
  const metadata = { ...owner.labels, ...extraLabels };
  if (owner.appName === undefined) return { trn, labels: metadata };
  return await buildMetaRequest({
    trn,
    appName: owner.appName,
    appId: owner.appId,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  });
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
 * Upload a bundled script to the function registry and label it as owned by the app.
 * @param params - Function to upload
 */
export async function uploadTemporaryFunction(
  params: UploadTemporaryFunctionParams,
): Promise<void> {
  const { client, workspaceId, name, code, description, mode = "create" } = params;
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
  await writeMetadataLabelsDirect(
    client,
    await temporaryLabelWrite(params, resourceTrn(workspaceId, "function_registry", name)),
  );
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
  /** Functions registered under the shared name (default: the shared name). */
  functionNames?: readonly string[];
  /** What the resources run, used in warnings (e.g. `migration`). */
  subject: string;
  /** Sentence of the warning telling how a resource left behind gets removed. */
  leftoverNote: string;
  /** Receives the warning for a resource that could not be removed (default: `logger.warn`) */
  warn?: (message: string) => void;
}

/**
 * Remove the temporary resources created for a run.
 *
 * Teardown is best effort: a failure here must not mask the run's own
 * outcome, so every removal is attempted and an unexpected failure is reported
 * as a warning rather than raised.
 * @param params - Resources to remove
 * @returns Whether every resource is gone
 */
export async function teardownTemporaryWorkflow(
  params: TeardownTemporaryWorkflowParams,
): Promise<boolean> {
  const { client, workspaceId, name, workflowId, subject, leftoverNote } = params;
  const warn = params.warn ?? ((message: string) => logger.warn(message));
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
  for (const functionName of params.functionNames ?? [name]) {
    steps.push([
      "function",
      functionName,
      () => client.deleteFunctionRegistry({ workspaceId, name: functionName }),
    ]);
  }

  let removedAll = true;
  for (const [label, resource, run] of steps) {
    try {
      await run();
    } catch (error) {
      // An already-absent resource means teardown's goal is met; anything else
      // leaves a resource behind and has to stay diagnosable.
      if (isNotFoundError(error)) continue;
      removedAll = false;
      warn(
        `Could not remove the temporary ${subject} ${label} '${resource}': ` +
          `${error instanceof Error ? error.message : String(error)}. ${leftoverNote}`,
      );
    }
  }
  return removedAll;
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
 * @returns The newest executions first, or none when the workflow does not exist
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
  /** Function each job function runs, by job function name (default: the shared name). */
  scriptRefs?: Readonly<Record<string, string>>;
  /** Main job function of the workflow (default: the shared name). */
  mainJobFunctionName?: string;
  /** What the resources run, used in errors (e.g. `migration`). */
  subject: string;
  /** Extra labels for the workflow. */
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
  const { client, workspaceId, name, subject } = params;
  const versions: Record<string, bigint> = {};
  for (const jobFunctionName of params.jobFunctionNames) {
    const { jobFunction } = await client.createWorkflowJobFunction({
      workspaceId,
      jobFunctionName,
      scriptRef: params.scriptRefs?.[jobFunctionName] ?? name,
      publishExecutionEvents: false,
    });
    await writeMetadataLabelsDirect(
      client,
      await temporaryLabelWrite(
        params,
        resourceTrn(workspaceId, "workflow_job_function", jobFunctionName),
      ),
    );
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
    mainJobFunctionName: params.mainJobFunctionName ?? name,
    jobFunctions: versions,
  });
  const workflowId = workflow?.id;
  if (!workflowId) {
    throw internalError(`Temporary ${subject} workflow '${name}' was created without an id.`);
  }
  created.workflowId = workflowId;
  await writeMetadataLabelsDirect(
    client,
    await temporaryLabelWrite(
      params,
      resourceTrn(workspaceId, "workflow", name),
      params.workflowLabels,
    ),
  );
  return workflowId;
}

/** Code of the error {@link pollUntilTerminal} throws when its deadline passes. */
export const POLL_DEADLINE_EXCEEDED = "WORKFLOW_POLL_DEADLINE_EXCEEDED";

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
  /** Epoch milliseconds after which polling stops with {@link POLL_DEADLINE_EXCEEDED} */
  deadline?: number;
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
  const {
    client,
    workspaceId,
    executionId,
    pollInterval,
    subject,
    deadline,
    options = {},
  } = params;
  const throwIfPastDeadline = (expired = false) => {
    if (deadline === undefined || (!expired && Date.now() < deadline)) return;
    throw CLIError({
      code: POLL_DEADLINE_EXCEEDED,
      message: `${subject} workflow execution '${executionId}' did not finish in time.`,
    });
  };
  const sleepUntilNextPoll = async () => {
    throwIfPastDeadline();
    const wait =
      deadline === undefined ? pollInterval : Math.min(pollInterval, deadline - Date.now());
    await new Promise((resolve) => setTimeout(resolve, wait));
  };
  // loop exits when the workflow execution reaches a terminal status
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  while (true) {
    let execution: WorkflowExecution | undefined;
    let lookupSignal: AbortSignal | undefined;
    try {
      throwIfPastDeadline();
      if (deadline !== undefined) {
        lookupSignal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
      }
      const request = { workspaceId, executionId };
      ({ execution } = await (lookupSignal
        ? client.getWorkflowExecution(request, { signal: lookupSignal })
        : client.getWorkflowExecution(request)));
    } catch (error) {
      // The signal fires on the deadline, but its timer can run a few milliseconds ahead of the clock.
      throwIfPastDeadline(lookupSignal?.aborted);
      if (!isRetryableWaitError(error)) throw error;
      options.onPollFailed?.();
      await sleepUntilNextPoll();
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
    await sleepUntilNextPoll();
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
