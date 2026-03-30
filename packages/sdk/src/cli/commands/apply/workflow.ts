import { type ApplyPhase } from "@/cli/commands/apply/apply";
import { parseDuration } from "@/cli/shared/args";
import { type OperatorClient, fetchAll } from "@/cli/shared/client";
import { logger, styles } from "@/cli/shared/logger";
import { createChangeSet, type ChangeSet, type HasName } from "./change-set";
import { areNormalizedEqual, formatAddedPropertyLines, formatPropertyDiffLines } from "./compare";
import { workflowJobFunctionName } from "./function-registry";
import {
  actionSymbol,
  buildRemainingFunctionRegistryEntries,
  createRelatedFunctionRegistryNameSets,
  formatScriptAddedLine,
  formatScriptChangedLine,
  type DisplayAction,
  type GroupedDisplayEntry,
  type RelatedFunctionRegistryNameSets,
  type RelatedFunctionRegistryChanges,
} from "./grouped-display";
import { buildMetaRequest, hasMatchingSdkVersion, sdkNameLabelKey, type WithLabel } from "./label";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { Workflow, RetryPolicy } from "@/types/workflow.generated";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-proto/tailor/v1/metadata_pb";
import type { RetryPolicySchema } from "@tailor-proto/tailor/v1/workflow_resource_pb";

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
  const { changeSet, appName } = result;
  if (phase === "create-update") {
    // Register job functions used by any workflow, returns map of job name to version
    const jobFunctionVersions = await registerJobFunctions(
      client,
      changeSet,
      appName,
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
        });
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else if (phase === "delete") {
    // Delete workflows
    await Promise.all(
      changeSet.deletes.map((del) =>
        client.deleteWorkflow({
          workspaceId: del.workspaceId,
          workflowId: del.workflowId,
        }),
      ),
    );
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
 * Sets metadata on used JobFunctions and removes metadata from unused ones.
 * @param client - Operator client instance
 * @param changeSet - Workflow change set
 * @param appName - Application name
 * @param unchangedWorkflowJobNames - Job function names used by unchanged workflows
 * @returns Map of job function names to versions
 */
async function registerJobFunctions(
  client: OperatorClient,
  changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
  appName: string,
  unchangedWorkflowJobNames: ReadonlySet<string> = new Set(),
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
          await buildMetaRequest(jobFunctionTrn(workspaceId, jobName), appName),
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

  // Remove metadata from JobFunctions that are no longer used by this app
  const unusedJobFunctions = existingJobFunctions.filter(
    (jobName) => !allUsedJobNames.has(jobName),
  );
  await Promise.all(
    unusedJobFunctions.map(async (jobName) => {
      const { metadata } = await client.getMetadata({
        trn: jobFunctionTrn(workspaceId, jobName),
      });
      const label = metadata?.labels?.[sdkNameLabelKey];

      // Only remove metadata if owned by this app
      if (label === appName) {
        await client.setMetadata({
          trn: jobFunctionTrn(workspaceId, jobName),
          labels: { [sdkNameLabelKey]: "" }, // Remove ownership
        });
      }
    }),
  );

  return jobFunctionVersions;
}

type CreateWorkflow = {
  name: string;
  detailLines?: string[];
  workspaceId: string;
  workflow: Workflow;
  usedJobNames: string[];
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdateWorkflow = {
  name: string;
  detailLines?: string[];
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

function workflowTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:workflow:${name}`;
}

function jobFunctionTrn(workspaceId: string, name: string) {
  return `trn:v1:workspace:${workspaceId}:workflow_job_function:${name}`;
}

/**
 * Plan workflow changes and job functions based on current and desired state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param appName - Application name
 * @param workflows - Parsed workflows
 * @param mainJobDeps - Main job dependencies by workflow
 * @param unchangedJobFunctions - Job functions already proven unchanged by function registry plan
 * @param workflowJobFunctionChanges - Related function registry changes for workflow jobs
 * @param workflowJobFunctionChanges.creates - Function registry creations
 * @param workflowJobFunctionChanges.updates - Function registry updates
 * @param workflowJobFunctionChanges.deletes - Function registry deletions
 * @param workflowJobFunctionChanges.replaces - Function registry replacements
 * @param workflowJobFunctionChanges.unchanged - Function registry unchanged entries
 * @param detailPlan - Whether to print detailed property-level changes
 * @returns Planned workflow changes
 */
export async function planWorkflow(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  workflows: Record<string, Workflow>,
  mainJobDeps: Record<string, string[]>,
  unchangedJobFunctions: ReadonlySet<string> = new Set<string>(),
  workflowJobFunctionChanges?: {
    creates: ReadonlyArray<HasName>;
    updates: ReadonlyArray<HasName>;
    deletes: ReadonlyArray<HasName>;
    replaces: ReadonlyArray<HasName>;
    unchanged: ReadonlyArray<HasName>;
  },
  detailPlan = false,
) {
  const changeSet = createChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>("Workflows");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();
  const unchangedWorkflowJobNames = new Set<string>();

  // Fetch existing workflows from API
  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    const response = await client.listWorkflows({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [response.workflows, response.nextPageToken];
  });
  const existingWorkflows: WithLabel<(typeof withoutLabel)[number]> = {};
  await Promise.all(
    withoutLabel.map(async (resource) => {
      const { metadata } = await client.getMetadata({
        trn: workflowTrn(workspaceId, resource.name),
      });
      existingWorkflows[resource.name] = {
        resource,
        label: metadata?.labels[sdkNameLabelKey],
        allLabels: metadata?.labels,
      };
    }),
  );

  for (const workflow of Object.values(workflows)) {
    const existing = existingWorkflows[workflow.name];
    const metaRequest = await buildMetaRequest(workflowTrn(workspaceId, workflow.name), appName);
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

    if (existing) {
      if (!existing.label) {
        unmanaged.push({
          resourceType: "Workflow",
          resourceName: workflow.name,
        });
      } else if (existing.label !== appName) {
        conflicts.push({
          resourceType: "Workflow",
          resourceName: workflow.name,
          currentOwner: existing.label,
        });
      }

      if (
        existing.label === appName &&
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
        const existingComparable = {
          mainJobFunctionName: existing.resource.mainJobFunctionName,
          retryPolicy: normalizeComparableExistingWorkflowRetryPolicy(
            existing.resource.retryPolicy,
          ),
          jobFunctions: normalizeComparableWorkflowJobNames(existing.resource.jobFunctions),
        };
        const desiredComparable = {
          mainJobFunctionName: workflow.mainJob.name,
          retryPolicy: normalizeComparableWorkflowRetryPolicy(workflow.retryPolicy),
          jobFunctions: normalizeComparableWorkflowJobNames(usedJobNames),
        };
        changeSet.updates.push({
          name: workflow.name,
          detailLines: formatPropertyDiffLines(existingComparable, desiredComparable),
          workspaceId,
          workflow,
          usedJobNames,
          metaRequest,
        });
      }
      delete existingWorkflows[workflow.name];
    } else {
      const desiredComparable = {
        mainJobFunctionName: workflow.mainJob.name,
        retryPolicy: normalizeComparableWorkflowRetryPolicy(workflow.retryPolicy),
        jobFunctions: normalizeComparableWorkflowJobNames(usedJobNames),
      };
      changeSet.creates.push({
        name: workflow.name,
        detailLines: formatAddedPropertyLines(desiredComparable),
        workspaceId,
        workflow,
        usedJobNames,
        metaRequest,
      });
    }
  }

  Object.values(existingWorkflows).forEach((existing) => {
    if (!existing) {
      return;
    }
    const label = existing.label;
    if (label && label !== appName) {
      resourceOwners.add(label);
    }
    // Only delete workflows managed by this application
    if (label === appName) {
      changeSet.deletes.push({
        name: existing.resource.name,
        workspaceId,
        workflowId: existing.resource.id,
        usedJobNames: getExistingWorkflowJobNames(existing.resource),
      });
    }
  });

  printWorkflowChanges(changeSet, workflowJobFunctionChanges, detailPlan);
  return {
    changeSet,
    conflicts,
    unmanaged,
    resourceOwners,
    appName,
    unchangedWorkflowJobNames,
  };
}

type WorkflowDisplayEntry = GroupedDisplayEntry;

function collectWorkflowDisplayEntries<
  T extends Pick<CreateWorkflow | UpdateWorkflow, "name" | "usedJobNames"> & {
    detailLines?: string[];
  },
>(
  action: DisplayAction,
  workflowItems: ReadonlyArray<T>,
  workflowJobFunctionNames: ReadonlySet<string>,
  consumedWorkflowJobFunctionNames: Set<string>,
) {
  return workflowItems.map((item) => {
    const matchingFunctionNames = new Set<string>();
    for (const jobName of item.usedJobNames) {
      const functionName = workflowJobFunctionName(jobName);
      if (workflowJobFunctionNames.has(functionName)) {
        matchingFunctionNames.add(functionName);
      }
    }
    for (const functionName of matchingFunctionNames) {
      consumedWorkflowJobFunctionNames.add(functionName);
    }
    const detailLines =
      matchingFunctionNames.size > 0
        ? [
            ...(item.detailLines ?? []),
            action === "create"
              ? formatScriptAddedLine()
              : action === "update"
                ? formatScriptChangedLine()
                : undefined,
          ].filter((line): line is string => line != null)
        : item.detailLines;
    return {
      action,
      symbol: actionSymbol(action),
      name: item.name,
      labels: matchingFunctionNames.size > 0 ? ["workflow", "functionRegistry"] : ["workflow"],
      detailLines: detailLines != null && detailLines.length > 0 ? detailLines : undefined,
    };
  });
}

/**
 * Format workflow changes for grouped dry-run display.
 * @param changeSet - Workflow changes
 * @param workflowJobFunctionChanges - Related function registry changes for workflow jobs
 * @param workflowJobFunctionChanges.creates - Function registry creations
 * @param workflowJobFunctionChanges.updates - Function registry updates
 * @param workflowJobFunctionChanges.deletes - Function registry deletions
 * @param workflowJobFunctionChanges.replaces - Function registry replacements
 * @returns Display entries for workflow output
 */
export function formatWorkflowChangeEntries(
  changeSet: Pick<
    ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
    "creates" | "updates" | "deletes" | "replaces"
  >,
  workflowJobFunctionChanges?: RelatedFunctionRegistryChanges,
): WorkflowDisplayEntry[] {
  const functionNames = createRelatedFunctionRegistryNameSets(workflowJobFunctionChanges);
  const consumed: RelatedFunctionRegistryNameSets = createRelatedFunctionRegistryNameSets();

  const entries = [
    ...collectWorkflowDisplayEntries(
      "create",
      changeSet.creates,
      functionNames.creates,
      consumed.creates,
    ),
    ...collectWorkflowDisplayEntries(
      "delete",
      changeSet.deletes,
      functionNames.deletes,
      consumed.deletes,
    ),
    ...collectWorkflowDisplayEntries(
      "update",
      changeSet.updates,
      functionNames.updates,
      consumed.updates,
    ),
    ...(changeSet.replaces as ReadonlyArray<HasName>).map((item) => ({
      action: "replace" as const,
      symbol: actionSymbol("replace"),
      name: item.name,
      labels: ["workflow"],
    })),
    ...buildRemainingFunctionRegistryEntries(functionNames, consumed).map((entry) => ({
      ...entry,
      detailLines:
        entry.action === "create"
          ? [formatScriptAddedLine()]
          : entry.action === "update"
            ? [formatScriptChangedLine()]
            : entry.detailLines,
    })),
  ];
  return entries;
}

function printWorkflowChanges(
  changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
  workflowJobFunctionChanges?: {
    creates: ReadonlyArray<HasName>;
    updates: ReadonlyArray<HasName>;
    deletes: ReadonlyArray<HasName>;
    replaces: ReadonlyArray<HasName>;
  },
  detail = false,
) {
  const entries = formatWorkflowChangeEntries(changeSet, workflowJobFunctionChanges);
  if (entries.length === 0) {
    return;
  }

  logger.log(styles.bold("Workflows:"));
  for (const entry of entries) {
    logger.log(`  ${entry.symbol} ${entry.name} (${entry.labels.join(", ")})`);
    if (detail) {
      entry.detailLines?.forEach((line) => logger.log(`    ${line}`));
    }
  }
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

function normalizeComparableWorkflowJobNames(
  jobFunctions: Record<string, string | bigint> | readonly string[] | undefined,
) {
  return Array.isArray(jobFunctions)
    ? [...jobFunctions].sort()
    : Object.keys(jobFunctions ?? {}).sort();
}

function getExistingWorkflowJobNames(existing: {
  mainJobFunctionName?: string;
  jobFunctions?: Record<string, string | bigint>;
}) {
  const jobNames = new Set(Object.keys(existing.jobFunctions ?? {}));
  if (existing.mainJobFunctionName) {
    jobNames.add(existing.mainJobFunctionName);
  }
  return [...jobNames].sort();
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
