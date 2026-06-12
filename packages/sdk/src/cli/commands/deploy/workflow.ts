import { Code, ConnectError } from "@connectrpc/connect";
import { parseDuration } from "@/cli/shared/args";
import { type OperatorClient, fetchAll } from "@/cli/shared/client";
import { logger } from "@/cli/shared/logger";
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
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase } from "./phase";
import type { ConcurrencyPolicy, Workflow, RetryPolicy } from "@/types/workflow.generated";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";
import type {
  ConcurrencyPolicySchema,
  RetryPolicySchema,
} from "@tailor-proto/tailor/v1/workflow_resource_pb";

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
    );

    // Create and update workflows in parallel
    // Each workflow only gets the job function versions it actually uses
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        const filteredVersions = filterJobFunctionVersions(
          jobFunctionVersions,
          create.usedJobNames,
        );
        await client.createWorkflow({
          workspaceId: create.workspaceId,
          workflowName: create.workflow.name,
          mainJobFunctionName: create.workflow.mainJob.name,
          jobFunctions: filteredVersions,
          ...(create.workflow.retryPolicy && {
            retryPolicy: toRetryPolicy(create.workflow.retryPolicy),
          }),
          ...(create.workflow.concurrencyPolicy && {
            concurrencyPolicy: toConcurrencyPolicy(create.workflow.concurrencyPolicy),
          }),
        });
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        const filteredVersions = filterJobFunctionVersions(
          jobFunctionVersions,
          update.usedJobNames,
        );
        await client.updateWorkflow({
          workspaceId: update.workspaceId,
          workflowName: update.workflow.name,
          mainJobFunctionName: update.workflow.mainJob.name,
          jobFunctions: filteredVersions,
          ...(update.workflow.retryPolicy && {
            retryPolicy: toRetryPolicy(update.workflow.retryPolicy),
          }),
          ...(update.workflow.concurrencyPolicy && {
            concurrencyPolicy: toConcurrencyPolicy(update.workflow.concurrencyPolicy),
          }),
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
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      (result.jobFunctionDeletes ?? collectDeletableJobFunctions(changeSet.deletes)).map((del) => ({
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
    const operation = operations[index];
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

function collectDeletableJobFunctions(deletes: readonly DeleteWorkflow[]) {
  const seen = new Set<string>();
  const jobFunctions: Array<{ workspaceId: string; jobFunctionName: string }> = [];
  for (const del of deletes) {
    for (const jobFunctionName of del.deletableJobNames) {
      const key = `${del.workspaceId}\0${jobFunctionName}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      jobFunctions.push({ workspaceId: del.workspaceId, jobFunctionName });
    }
  }
  return jobFunctions;
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
    // oxlint-disable-next-line typescript/no-unnecessary-condition
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
 * @param appId
 * @param unchangedWorkflowJobNames - Job function names used by unchanged workflows
 * @returns Map of job function names to versions
 */
async function registerJobFunctions(
  client: OperatorClient,
  changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
  appName: string,
  appId: string | undefined,
  unchangedWorkflowJobNames: ReadonlySet<string> = new Set(),
): Promise<{ [key: string]: bigint }> {
  const jobFunctionVersions: { [key: string]: bigint } = {};

  // Get workspaceId from the first workflow
  const firstWorkflow = changeSet.creates[0] || changeSet.updates[0] || changeSet.deletes[0];
  // oxlint-disable-next-line typescript/no-unnecessary-condition
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
        const response = isExisting
          ? await client.updateWorkflowJobFunction({
              workspaceId,
              jobFunctionName: jobName,
              scriptRef: workflowJobFunctionName(jobName),
            })
          : await client.createWorkflowJobFunction({
              workspaceId,
              jobFunctionName: jobName,
              scriptRef: workflowJobFunctionName(jobName),
            });

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

/**
 * Plan workflow changes and job functions based on current and desired state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param appName - Application name
 * @param appId
 * @param workflows - Parsed workflows
 * @param mainJobDeps - Main job dependencies by workflow
 * @param unchangedJobFunctions - Job functions already proven unchanged by function registry plan
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
) {
  const changeSet = createChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>("Workflows");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();
  const unchangedWorkflowJobNames = new Set<string>();
  const retainedWorkflowJobNames = new Set<string>();

  const existingWorkflows = await fetchExistingResourcesWithLabels({
    client,
    workspaceId,
    fetchPage: async (pageToken, pageSize) => {
      const response = await client.listWorkflows({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [response.workflows, response.nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (workspaceId, name) => resourceTrn(workspaceId, "workflow", name),
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
    // oxlint-disable-next-line typescript/no-unnecessary-condition
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
        canTreatWorkflowAsUnchanged(
          existing.resource,
          workflow,
          usedJobNames,
          unchangedJobFunctions,
        )
      ) {
        changeSet.unchanged.push({ name: workflow.name });
        for (const jobName of usedJobNames) {
          unchangedWorkflowJobNames.add(jobName);
        }
      } else {
        changeSet.updates.push({
          name: workflow.name,
          workspaceId,
          workflow,
          usedJobNames,
          metaRequest,
        });
      }
      delete existingWorkflows[workflow.name];
    } else {
      changeSet.creates.push({
        name: workflow.name,
        workspaceId,
        workflow,
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
  };
}

type PlanWorkflowJobFunctionDeletesParams = {
  client: OperatorClient;
  workspaceId: string;
  appName: string;
  appId: string | undefined;
  retainedWorkflowJobNames: ReadonlySet<string>;
};

async function planWorkflowJobFunctionDeletes(
  params: PlanWorkflowJobFunctionDeletesParams,
): Promise<DeleteWorkflowJobFunction[]> {
  const { client, workspaceId, appName, appId, retainedWorkflowJobNames } = params;
  const existingJobFunctions = await fetchAll(async (pageToken, maxPageSize) => {
    const response = await client.listWorkflowJobFunctions({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [response.jobFunctions.map((jobFunction) => jobFunction.name), response.nextPageToken];
  });
  const candidates = [...new Set(existingJobFunctions)].filter(
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

function canTreatWorkflowAsUnchanged(
  existing: {
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
  },
  workflow: Workflow,
  usedJobNames: string[],
  unchangedJobFunctions: ReadonlySet<string>,
) {
  if (!usedJobNames.every((jobName) => unchangedJobFunctions.has(jobName))) {
    return false;
  }
  return areWorkflowsEqual(existing, workflow, usedJobNames);
}

function areWorkflowsEqual(
  existing: {
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
  },
  workflow: Workflow,
  usedJobNames: readonly string[],
) {
  return (
    existing.mainJobFunctionName === workflow.mainJob.name &&
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
