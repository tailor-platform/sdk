import { type ApplyPhase } from "@/cli/commands/apply/apply";
import { parseDuration } from "@/cli/shared/args";
import { type OperatorClient, fetchAll } from "@/cli/shared/client";
import { createChangeSet, type ChangeSet } from "./change-set";
import { workflowJobFunctionName } from "./function-registry";
import { buildMetaRequest, sdkNameLabelKey, type WithLabel } from "./label";
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
    const jobFunctionVersions = await registerJobFunctions(client, changeSet, appName);

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
 * @returns Map of job function names to versions
 */
async function registerJobFunctions(
  client: OperatorClient,
  changeSet: ChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>,
  appName: string,
): Promise<{ [key: string]: bigint }> {
  const jobFunctionVersions: { [key: string]: bigint } = {};

  // Get workspaceId from the first workflow
  const firstWorkflow = changeSet.creates[0] || changeSet.updates[0];
  if (!firstWorkflow) {
    return jobFunctionVersions;
  }

  const { workspaceId } = firstWorkflow;

  // Collect all job names used by any workflow
  const allUsedJobNames = new Set<string>();
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
    ...(policy.initialBackoff && { initialBackoff: parseDurationToProto(policy.initialBackoff) }),
    ...(policy.maxBackoff && { maxBackoff: parseDurationToProto(policy.maxBackoff) }),
    ...(policy.backoffMultiplier !== undefined && { backoffMultiplier: policy.backoffMultiplier }),
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
 * @returns Planned workflow changes
 */
export async function planWorkflow(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  workflows: Record<string, Workflow>,
  mainJobDeps: Record<string, string[]>,
) {
  const changeSet = createChangeSet<CreateWorkflow, UpdateWorkflow, DeleteWorkflow>("Workflows");
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  // Fetch existing workflows from API
  const withoutLabel = await fetchAll(async (pageToken, maxPageSize) => {
    const response = await client.listWorkflows({
      workspaceId,
      pageToken,
      pageSize: maxPageSize,
    });
    return [response.workflows.map((w) => ({ id: w.id, name: w.name })), response.nextPageToken];
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

      changeSet.updates.push({
        name: workflow.name,
        workspaceId,
        workflow,
        usedJobNames,
        metaRequest,
      });
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

  Object.values(existingWorkflows).forEach((existing) => {
    const label = existing?.label;
    if (label && label !== appName) {
      resourceOwners.add(label);
    }
    // Only delete workflows managed by this application
    if (label === appName) {
      changeSet.deletes.push({
        name: existing!.resource.name,
        workspaceId,
        workflowId: existing!.resource.id,
      });
    }
  });

  changeSet.print();
  return { changeSet, conflicts, unmanaged, resourceOwners, appName };
}
