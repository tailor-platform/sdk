import { Code, ConnectError } from "@connectrpc/connect";
import { parseDuration } from "#/cli/shared/args";
import { type OperatorClient, fetchAll } from "#/cli/shared/client";
import { logger } from "#/cli/shared/logger";
import { publishEventsConflict, resolvePublishEvents } from "#/cli/shared/publish-events";
import { assertDefined } from "#/utils/assert";
import { createChangeSet, type ChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { workflowJobFunctionName } from "./function-registry";
import {
  formatChangeEntriesWithFunctionRegistry,
  type GroupedDisplayEntry,
  type RelatedFunctionRegistryChanges,
} from "./grouped-display";
import { buildMetaRequest, hasMatchingSdkVersion, isOwnedByApp, resourceTrn } from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { ConcurrencyPolicy, Workflow, RetryPolicy } from "#/types/workflow.generated";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase } from "./phase";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-platform/tailor-proto/metadata_pb";
import type { CreateWorkflowRequestSchema } from "@tailor-platform/tailor-proto/workflow_pb";
import type {
  ConcurrencyPolicySchema,
  RetryPolicySchema,
  WorkflowJobFunctionSummary,
} from "@tailor-platform/tailor-proto/workflow_resource_pb";

/**
 * Apply workflow changes for the given phase.
 * @param client - Operator client instance
 * @param result - Planned workflow changes
 * @param phase - Apply phase
 * @returns Promise that resolves when workflows are applied
 */
export async function applyWorkflow(
  client: OperatorClient,
  result: Awaited<ReturnType<typeof planWorkflow>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
) {
  const { changeSet, appName, appId } = result;
  if (phase === "create-update") {
    // Register job functions used by any workflow, returns map of job name to version
    const jobFunctionVersions = await registerJobFunctions(
      client,
      changeSet,
      appName,
      appId,
      result.unchangedWorkflowJobNames,
      result.jobFunctionPublishEvents,
    );

    // Create and update workflows in parallel
    // Each workflow only gets the job function versions it actually uses
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        const filteredVersions = filterJobFunctionVersions(
          jobFunctionVersions,
          create.usedJobNames,
        );
        const shape = buildWorkflowValidationShape(create.workspaceId, create.workflow);
        await client.createWorkflow({
          workspaceId: shape.workspaceId,
          workflowName: shape.workflowName,
          mainJobFunctionName: shape.mainJobFunctionName,
          retryPolicy: shape.retryPolicy,
          concurrencyPolicy: shape.concurrencyPolicy,
          jobFunctions: filteredVersions,
          publishExecutionEvents: shape.publishExecutionEvents,
        });
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        const filteredVersions = filterJobFunctionVersions(
          jobFunctionVersions,
          update.usedJobNames,
        );
        const shape = buildWorkflowValidationShape(update.workspaceId, update.workflow);
        await client.updateWorkflow({
          workspaceId: shape.workspaceId,
          workflowName: shape.workflowName,
          mainJobFunctionName: shape.mainJobFunctionName,
          retryPolicy: shape.retryPolicy,
          concurrencyPolicy: shape.concurrencyPolicy,
          jobFunctions: filteredVersions,
          publishExecutionEvents: shape.publishExecutionEvents,
        });
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else {
    await deleteAllSettled(
      changeSet.deletes.map((del) => ({
        resourceType: "workflow",
        resourceName: del.name,
        run: () =>
          client.deleteWorkflow({
            workspaceId: del.workspaceId,
            workflowId: del.workflowId,
          }),
      })),
    );

    await deleteAllSettled(
      result.jobFunctionDeletes.map((del) => ({
        resourceType: "workflow job function",
        resourceName: del.jobFunctionName,
        run: () =>
          client.deleteWorkflowJobFunction({
            workspaceId: del.workspaceId,
            jobFunctionName: del.jobFunctionName,
          }),
      })),
    );
  }
}

type DeleteOperation = {
  resourceType: string;
  resourceName: string;
  run: () => Promise<unknown>;
};

async function deleteAllSettled(operations: readonly DeleteOperation[]) {
  const results = await Promise.allSettled(operations.map((operation) => operation.run()));
  const errors: unknown[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      return;
    }
    const operation = assertDefined(operations[index], "operation missing at index");
    const error = result.reason;
    if (error instanceof ConnectError && error.code === Code.NotFound) {
      return;
    }
    if (error instanceof ConnectError && error.code === Code.FailedPrecondition) {
      logger.warn(
        `Skipped deleting ${operation.resourceType} "${operation.resourceName}" because it is still referenced.`,
      );
      return;
    }
    errors.push(error);
  });
  const firstError = errors[0];
  if (firstError) {
    throw firstError;
  }
}

/**
 * Filter job function versions to only include those used by a workflow
 * @param allVersions - Map of job function names to versions
 * @param usedJobNames - Job names used by the workflow
 * @returns Filtered job function versions
 */
function filterJobFunctionVersions(
  allVersions: { [key: string]: bigint },
  usedJobNames: string[],
): { [key: string]: bigint } {
  const filtered: { [key: string]: bigint } = {};
  for (const jobName of usedJobNames) {
    if (allVersions[jobName] !== undefined) {
      filtered[jobName] = allVersions[jobName];
    }
  }
  return filtered;
}

/**
 * Register job functions used by any workflow.
 * Only registers jobs that are actually used (based on usedJobNames in changeSet).
 * Uses create for new jobs and update for existing jobs.
 * Sets metadata on used JobFunctions.
 * @param client - Operator client instance
 * @param changeSet - Workflow change set
 * @param appName - Application name
 * @param appId - Application ID used for job function metadata when available
 * @param unchangedWorkflowJobNames - Job function names used by unchanged workflows
 * @param jobFunctionPublishEvents - Resolved `publishExecutionEvents` keyed by job function name
 * @returns Map of job function names to versions
 */
async function registerJobFunctions(
  client: OperatorClient,
  changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
  appName: string,
  appId: string | undefined,
  unchangedWorkflowJobNames: ReadonlySet<string> = new Set(),
  jobFunctionPublishEvents: ReadonlyMap<string, boolean> = new Map(),
): Promise<{ [key: string]: bigint }> {
  const jobFunctionVersions: { [key: string]: bigint } = {};

  // Get workspaceId from the first workflow
  const firstWorkflow = changeSet.creates[0] || changeSet.updates[0] || changeSet.deletes[0];
  if (!firstWorkflow) {
    return jobFunctionVersions;
  }

  const { workspaceId } = firstWorkflow;

  // Collect all job names used by any workflow
  const allUsedJobNames = new Set<string>();
  unchangedWorkflowJobNames.forEach((jobName) => allUsedJobNames.add(jobName));
  for (const item of [...changeSet.creates, ...changeSet.updates]) {
    for (const jobName of item.usedJobNames) {
      allUsedJobNames.add(jobName);
    }
  }
  // Fetch existing job functions with their names
  const existingJobFunctions = await fetchAll(async (pageToken, maxPageSize) => {
    const response = await client.listWorkflowJobFunctions({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [response.jobFunctions.map((j) => j.name), response.nextPageToken];
  });
  const existingJobNamesSet = new Set(existingJobFunctions);

  if (changeSet.creates.length > 0 || changeSet.updates.length > 0) {
    // Register job functions in parallel
    // Use create for new jobs, update for existing jobs
    const results = await Promise.all(
      Array.from(allUsedJobNames).map(async (jobName) => {
        const isExisting = existingJobNamesSet.has(jobName);
        const request = {
          workspaceId,
          jobFunctionName: jobName,
          scriptRef: workflowJobFunctionName(jobName),
          publishExecutionEvents: jobFunctionPublishEvents.get(jobName) ?? false,
        };
        const response = isExisting
          ? await client.updateWorkflowJobFunction(request)
          : await client.createWorkflowJobFunction(request);

        // Set metadata to mark this JobFunction as owned by this app
        await client.setMetadata(
          await buildMetaRequest({
            trn: resourceTrn(workspaceId, "workflow_job_function", jobName),
            appName,
            appId,
          }),
        );

        return { jobName, version: response.jobFunction?.version };
      }),
    );

    for (const { jobName, version } of results) {
      if (version) {
        jobFunctionVersions[jobName] = version;
      }
    }
  }

  return jobFunctionVersions;
}

type CreateWorkflow = {
  name: string;
  workspaceId: string;
  workflow: Workflow;
  usedJobNames: string[];
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateWorkflow = {
  name: string;
  workspaceId: string;
  workflow: Workflow;
  usedJobNames: string[];
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeleteWorkflow = {
  name: string;
  workspaceId: string;
  workflowId: string;
  usedJobNames: string[];
  deletableJobNames: string[];
};

type DeleteWorkflowJobFunction = {
  workspaceId: string;
  jobFunctionName: string;
};

function parseDurationToProto(duration: string): { seconds: bigint; nanos: number } {
  const ms = parseDuration(duration);
  const seconds = Math.floor(ms / 1000);
  const nanos = (ms % 1000) * 1_000_000;
  return { seconds: BigInt(seconds), nanos };
}

function toRetryPolicy(policy: RetryPolicy): MessageInitShape<typeof RetryPolicySchema> {
  return {
    maxRetries: policy.maxRetries,
    initialBackoff: parseDurationToProto(policy.initialBackoff),
    maxBackoff: parseDurationToProto(policy.maxBackoff),
    backoffMultiplier: policy.backoffMultiplier,
  };
}

function toConcurrencyPolicy(
  policy: ConcurrencyPolicy,
): MessageInitShape<typeof ConcurrencyPolicySchema> {
  return {
    maxConcurrentExecutions: policy.maxConcurrentExecutions,
  };
}

/** Plan-time init shape for Create/UpdateWorkflowRequest (jobFunctions excluded). */
export type WorkflowValidationShape = Omit<
  MessageInitShape<typeof CreateWorkflowRequestSchema>,
  "jobFunctions"
>;

/**
 * Build the plan-time validation init shape for a workflow.
 * @param workspaceId - Workspace ID
 * @param workflow - Parsed workflow object
 * @returns Init shape suitable for validating against CreateWorkflowRequestSchema and UpdateWorkflowRequestSchema
 */
export function buildWorkflowValidationShape(
  workspaceId: string,
  workflow: Workflow,
): WorkflowValidationShape {
  return {
    workspaceId,
    workflowName: workflow.name,
    mainJobFunctionName: workflow.mainJob.name,
    ...(workflow.retryPolicy && { retryPolicy: toRetryPolicy(workflow.retryPolicy) }),
    ...(workflow.concurrencyPolicy && {
      concurrencyPolicy: toConcurrencyPolicy(workflow.concurrencyPolicy),
    }),
    publishExecutionEvents: workflow.publishEvents ?? false,
  };
}

/** Executors subscribing to one granularity level of workflow execution events. */
export type WorkflowEventSubscribers = {
  /** Workflow names named by executor triggers. */
  workflowNames: ReadonlySet<string>;
};

/** Inputs deciding which workflows and job functions publish execution events. */
export type WorkflowEventPublishing = {
  /** Subscribers of `workflow.workflow_execution.*` events. */
  execution?: WorkflowEventSubscribers;
  /** Subscribers of `workflow.workflow_execution.job_execution.*` events. */
  jobExecution?: WorkflowEventSubscribers;
  /** `publishEvents` declared on jobs, keyed by job name. */
  jobPublishEvents?: ReadonlyMap<string, boolean>;
};

const NO_EVENT_SUBSCRIBERS: WorkflowEventSubscribers = {
  workflowNames: new Set(),
};

function isSubscribed(subscribers: WorkflowEventSubscribers, workflowName: string): boolean {
  return subscribers.workflowNames.has(workflowName);
}

type ResolveJobPublishEventsParams = {
  workflows: Record<string, Workflow>;
  mainJobDeps: Record<string, string[]>;
  subscribers: WorkflowEventSubscribers;
  explicit: ReadonlyMap<string, boolean>;
};

/**
 * Resolve `publishExecutionEvents` for every job function used by a workflow.
 *
 * A job execution trigger names a workflow rather than a job, so a subscription
 * opts in every job that workflow runs.
 * @param params - Workflows, their job dependencies, subscribers, and explicit job flags
 * @returns Resolved flags keyed by job function name
 */
function resolveJobPublishEvents(params: ResolveJobPublishEventsParams): Map<string, boolean> {
  const { workflows, mainJobDeps, subscribers, explicit } = params;
  const usedJobNames = new Set<string>();
  const subscribedJobNames = new Set<string>();
  for (const workflow of Object.values(workflows)) {
    const jobNames = mainJobDeps[workflow.mainJob.name];
    // A missing entry gets a fuller diagnostic from planWorkflow's own loop.
    if (!jobNames) {
      continue;
    }
    const subscribed = isSubscribed(subscribers, workflow.name);
    for (const jobName of jobNames) {
      usedJobNames.add(jobName);
      if (subscribed) {
        subscribedJobNames.add(jobName);
      }
    }
  }

  const resolved = new Map<string, boolean>();
  for (const jobName of usedJobNames) {
    resolved.set(
      jobName,
      resolvePublishEvents({
        explicit: explicit.get(jobName),
        subscribed: subscribedJobNames.has(jobName),
        conflict: publishEventsConflict.workflowJob(jobName),
      }),
    );
  }
  return resolved;
}

/**
 * Collect job functions whose remote publishing flag no longer matches the plan.
 * @param existing - Existing job functions keyed by name
 * @param resolved - Resolved `publishExecutionEvents` keyed by job function name
 * @returns Job function names needing re-registration
 */
function collectStaleJobFunctionNames(
  existing: ReadonlyMap<string, ExistingJobFunction>,
  resolved: ReadonlyMap<string, boolean>,
): Set<string> {
  const stale = new Set<string>();
  for (const [jobName, publishEvents] of resolved) {
    const remote = existing.get(jobName);
    if (remote && remote.publishExecutionEvents !== publishEvents) {
      stale.add(jobName);
    }
  }
  return stale;
}

/**
 * Plan workflow changes and job functions based on current and desired state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param appName - Application name
 * @param appId - Application ID used for workflow metadata when available
 * @param workflows - Parsed workflows
 * @param mainJobDeps - Main job dependencies by workflow
 * @param unchangedJobFunctions - Job functions already proven unchanged by function registry plan
 * @param eventPublishing - Executor subscriptions and explicit job flags driving execution event publishing
 * @returns Planned workflow changes
 */
export async function planWorkflow(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  workflows: Record<string, Workflow>,
  mainJobDeps: Record<string, string[]>,
  unchangedJobFunctions: ReadonlySet<string> = new Set<string>(),
  eventPublishing: WorkflowEventPublishing = {},
) {
  const changeSet = createChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>("Workflows");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();
  const unchangedWorkflowJobNames = new Set<string>();
  const retainedWorkflowJobNames = new Set<string>();

  const executionSubscribers = eventPublishing.execution ?? NO_EVENT_SUBSCRIBERS;
  const existingJobFunctions = await fetchExistingJobFunctions(client, workspaceId);
  const jobFunctionPublishEvents = resolveJobPublishEvents({
    workflows,
    mainJobDeps,
    subscribers: eventPublishing.jobExecution ?? NO_EVENT_SUBSCRIBERS,
    explicit: eventPublishing.jobPublishEvents ?? new Map<string, boolean>(),
  });
  const staleJobFunctionNames = collectStaleJobFunctionNames(
    existingJobFunctions,
    jobFunctionPublishEvents,
  );

  const existingWorkflows = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, pageSize) => {
      const response = await client.listWorkflows({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [response.workflows, response.nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (name) => resourceTrn(workspaceId, "workflow", name),
  });

  for (const workflow of Object.values(workflows)) {
    const existing = existingWorkflows[workflow.name];
    const metaRequest = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "workflow", workflow.name),
      appName,
      appId,
    });
    // Get jobs used by this workflow from mainJobDeps
    const usedJobNames = mainJobDeps[workflow.mainJob.name];
    if (!usedJobNames) {
      throw new Error(
        `Job "${workflow.mainJob.name}" (mainJob of workflow "${workflow.name}") was not found.\n\n` +
          `Possible causes:\n` +
          `  - The job is not exported as a named export\n` +
          `  - The file containing the job is not included in workflow.files glob pattern\n\n` +
          `Solution:\n` +
          `  export const ${workflow.mainJob.name} = createWorkflowJob({ name: "${workflow.mainJob.name}", ... })`,
      );
    }
    usedJobNames.forEach((jobName) => retainedWorkflowJobNames.add(jobName));

    const desiredWorkflow: Workflow = {
      ...workflow,
      publishEvents: resolvePublishEvents({
        explicit: workflow.publishEvents,
        subscribed: isSubscribed(executionSubscribers, workflow.name),
        conflict: publishEventsConflict.workflow(workflow.name),
      }),
    };

    if (existing) {
      const owned = trackDesiredResourceOwnership({
        labels: existing.allLabels,
        ownerLabel: existing.label,
        appName,
        appId,
        resourceType: "Workflow",
        resourceName: workflow.name,
        conflicts,
        unmanaged,
      });

      if (
        owned &&
        hasMatchingSdkVersion(existing.allLabels, metaRequest.labels) &&
        canTreatWorkflowAsUnchanged({
          existing: existing.resource,
          workflow: desiredWorkflow,
          usedJobNames,
          unchangedJobFunctions,
          staleJobFunctionNames,
        })
      ) {
        changeSet.unchanged.push({ name: workflow.name });
        for (const jobName of usedJobNames) {
          unchangedWorkflowJobNames.add(jobName);
        }
      } else {
        changeSet.updates.push({
          name: workflow.name,
          workspaceId,
          workflow: desiredWorkflow,
          usedJobNames,
          metaRequest,
        });
      }
      delete existingWorkflows[workflow.name];
    } else {
      changeSet.creates.push({
        name: workflow.name,
        workspaceId,
        workflow: desiredWorkflow,
        usedJobNames,
        metaRequest,
      });
    }
  }

  const deleteWorkflows: DeleteWorkflow[] = [];
  Object.values(existingWorkflows).forEach((existing) => {
    if (!existing) {
      return;
    }
    const owned = trackRemainingResourceOwner({
      labels: existing.allLabels,
      ownerLabel: existing.label,
      appName,
      appId,
      resourceOwners,
    });
    const usedJobNames = getExistingWorkflowJobNames(existing.resource);
    if (owned) {
      deleteWorkflows.push({
        name: existing.resource.name,
        workspaceId,
        workflowId: existing.resource.id,
        usedJobNames,
        deletableJobNames: [],
      });
    } else {
      usedJobNames.forEach((jobName) => retainedWorkflowJobNames.add(jobName));
    }
  });

  const jobFunctionDeletes = await planWorkflowJobFunctionDeletes({
    client,
    workspaceId,
    appName,
    appId,
    existingJobFunctionNames: [...existingJobFunctions.keys()],
    retainedWorkflowJobNames,
  });
  const deletableJobNames = new Set(jobFunctionDeletes.map((del) => del.jobFunctionName));

  for (const del of deleteWorkflows) {
    changeSet.deletes.push({
      ...del,
      deletableJobNames: del.usedJobNames.filter(
        (jobName) => !retainedWorkflowJobNames.has(jobName) && deletableJobNames.has(jobName),
      ),
    });
  }

  return {
    changeSet,
    conflicts,
    unmanaged,
    resourceOwners,
    appName,
    appId,
    unchangedWorkflowJobNames,
    jobFunctionDeletes,
    jobFunctionPublishEvents,
  };
}

/** Existing job function as reported by the platform's job function listing. */
type ExistingJobFunction = Pick<WorkflowJobFunctionSummary, "name" | "publishExecutionEvents">;

async function fetchExistingJobFunctions(
  client: OperatorClient,
  workspaceId: string,
): Promise<ReadonlyMap<string, ExistingJobFunction>> {
  const jobFunctions = await fetchAll(async (pageToken, maxPageSize) => {
    const response = await client.listWorkflowJobFunctions({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [response.jobFunctions, response.nextPageToken];
  });
  return new Map(jobFunctions.map((jobFunction) => [jobFunction.name, jobFunction]));
}

type PlanWorkflowJobFunctionDeletesParams = {
  client: OperatorClient;
  workspaceId: string;
  appName: string;
  appId: string | undefined;
  existingJobFunctionNames: readonly string[];
  retainedWorkflowJobNames: ReadonlySet<string>;
};

async function planWorkflowJobFunctionDeletes(
  params: PlanWorkflowJobFunctionDeletesParams,
): Promise<DeleteWorkflowJobFunction[]> {
  const {
    client,
    workspaceId,
    appName,
    appId,
    existingJobFunctionNames,
    retainedWorkflowJobNames,
  } = params;
  const candidates = existingJobFunctionNames.filter(
    (jobName) => !retainedWorkflowJobNames.has(jobName),
  );
  const owned = await Promise.all(
    candidates.map(async (jobFunctionName) => {
      const { metadata } = await client.getMetadata({
        trn: resourceTrn(workspaceId, "workflow_job_function", jobFunctionName),
      });
      return isOwnedByApp(metadata?.labels, appName, appId)
        ? { workspaceId, jobFunctionName }
        : undefined;
    }),
  );
  return owned.filter((item): item is DeleteWorkflowJobFunction => item !== undefined);
}

type WorkflowDisplayEntry = GroupedDisplayEntry;

/**
 * Format workflow changes for grouped dry-run display.
 * @param changeSet - Workflow changes
 * @param workflowJobFunctionChanges - Related function registry changes for workflow jobs
 * @returns Display entries for workflow output
 */
export function formatWorkflowChangeEntries(
  changeSet: Pick<
    ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  workflowJobFunctionChanges?: RelatedFunctionRegistryChanges,
): WorkflowDisplayEntry[] {
  return formatChangeEntriesWithFunctionRegistry(
    "workflow",
    changeSet,
    workflowJobFunctionChanges,
    (item) =>
      "usedJobNames" in item
        ? item.usedJobNames.map((jobName) => workflowJobFunctionName(jobName))
        : [],
  );
}

type ExistingWorkflowResource = {
  mainJobFunctionName?: string;
  retryPolicy?: {
    maxRetries?: number;
    backoffMultiplier?: number;
    initialBackoff?: { seconds?: bigint; nanos?: number };
    maxBackoff?: { seconds?: bigint; nanos?: number };
  };
  concurrencyPolicy?: {
    maxConcurrentExecutions?: number;
  };
  jobFunctions?: Record<string, string | bigint>;
  publishExecutionEvents?: boolean;
};

type CanTreatWorkflowAsUnchangedParams = {
  existing: ExistingWorkflowResource;
  workflow: Workflow;
  usedJobNames: string[];
  unchangedJobFunctions: ReadonlySet<string>;
  staleJobFunctionNames: ReadonlySet<string>;
};

function canTreatWorkflowAsUnchanged(params: CanTreatWorkflowAsUnchangedParams) {
  const { existing, workflow, usedJobNames, unchangedJobFunctions, staleJobFunctionNames } = params;
  if (!usedJobNames.every((jobName) => unchangedJobFunctions.has(jobName))) {
    return false;
  }
  // Job functions are only re-registered while applying a workflow create/update.
  if (usedJobNames.some((jobName) => staleJobFunctionNames.has(jobName))) {
    return false;
  }
  return areWorkflowsEqual(existing, workflow, usedJobNames);
}

function areWorkflowsEqual(
  existing: ExistingWorkflowResource,
  workflow: Workflow,
  usedJobNames: readonly string[],
) {
  return (
    existing.mainJobFunctionName === workflow.mainJob.name &&
    (existing.publishExecutionEvents ?? false) === (workflow.publishEvents ?? false) &&
    areNormalizedEqual(
      normalizeComparableExistingWorkflowRetryPolicy(existing.retryPolicy),
      normalizeComparableWorkflowRetryPolicy(workflow.retryPolicy),
    ) &&
    areNormalizedEqual(
      normalizeComparableConcurrencyPolicy(existing.concurrencyPolicy),
      normalizeComparableConcurrencyPolicy(workflow.concurrencyPolicy),
    ) &&
    areNormalizedEqual(
      normalizeComparableWorkflowJobNames(existing.jobFunctions),
      normalizeComparableWorkflowJobNames(usedJobNames),
    )
  );
}

function normalizeComparableExistingWorkflowRetryPolicy(
  policy:
    | {
        maxRetries?: number;
        backoffMultiplier?: number;
        initialBackoff?: { seconds?: bigint; nanos?: number };
        maxBackoff?: { seconds?: bigint; nanos?: number };
      }
    | undefined,
) {
  if (!policy) {
    return undefined;
  }

  return normalizeRetryPolicyForCompare({
    maxRetries: policy.maxRetries ?? 0,
    backoffMultiplier: policy.backoffMultiplier ?? 0,
    initialBackoff: {
      seconds: policy.initialBackoff?.seconds ?? 0n,
      nanos: policy.initialBackoff?.nanos ?? 0,
    },
    maxBackoff: {
      seconds: policy.maxBackoff?.seconds ?? 0n,
      nanos: policy.maxBackoff?.nanos ?? 0,
    },
  });
}

function normalizeComparableWorkflowRetryPolicy(policy: RetryPolicy | undefined) {
  if (!policy) {
    return undefined;
  }

  return normalizeRetryPolicyForCompare({
    maxRetries: policy.maxRetries,
    backoffMultiplier: policy.backoffMultiplier,
    initialBackoff: parseDurationToProto(policy.initialBackoff),
    maxBackoff: parseDurationToProto(policy.maxBackoff),
  });
}

function normalizeComparableConcurrencyPolicy(
  policy: { maxConcurrentExecutions?: number } | undefined,
) {
  if (!policy || !policy.maxConcurrentExecutions) {
    return undefined;
  }
  return { maxConcurrentExecutions: policy.maxConcurrentExecutions };
}

function normalizeComparableWorkflowJobNames(
  jobFunctions: Record<string, string | bigint> | readonly string[] | undefined,
) {
  return Array.isArray(jobFunctions)
    ? jobFunctions.toSorted()
    : Object.keys(jobFunctions ?? {}).toSorted();
}

function getExistingWorkflowJobNames(existing: {
  mainJobFunctionName?: string;
  jobFunctions?: Record<string, string | bigint>;
}) {
  const jobNames = new Set(Object.keys(existing.jobFunctions ?? {}));
  if (existing.mainJobFunctionName) {
    jobNames.add(existing.mainJobFunctionName);
  }
  return [...jobNames].toSorted();
}

function normalizeRetryPolicyForCompare(policy: {
  maxRetries: number;
  backoffMultiplier: number;
  initialBackoff: { seconds: bigint | number; nanos: number };
  maxBackoff: { seconds: bigint | number; nanos: number };
}) {
  return {
    maxRetries: policy.maxRetries,
    backoffMultiplier: policy.backoffMultiplier,
    initialBackoff: {
      seconds: String(policy.initialBackoff.seconds),
      nanos: policy.initialBackoff.nanos,
    },
    maxBackoff: {
      seconds: String(policy.maxBackoff.seconds),
      nanos: policy.maxBackoff.nanos,
    },
  };
}
