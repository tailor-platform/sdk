import { type OperatorClient } from "#/cli/shared/client";
import { WorkflowJobFunctionExecutionPolicySchema } from "#/parser/service/workflow/schema";
import { createChangeSet } from "./change-set";
import { areNormalizedEqual } from "./compare";
import { buildMetaRequest, hasMatchingSdkVersion, resourceTrn } from "./label";
import {
  fetchExistingResourcesWithLabels,
  trackDesiredResourceOwnership,
  trackRemainingResourceOwner,
} from "./owned-resource";
import type { ExecutionPolicyInstance } from "#/configure/services/workflow/execution-policy.types";
import type { OwnerConflict, UnmanagedResource } from "./confirm";
import type { ApplyPhase } from "./phase";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { SetMetadataRequestSchema } from "@tailor-platform/tailor-proto/metadata_pb";
import type { ConcurrencyPolicySchema } from "@tailor-platform/tailor-proto/workflow_resource_pb";

type CreatePolicy = {
  name: string;
  workspaceId: string;
  policy: ExecutionPolicyInstance;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type UpdatePolicy = {
  name: string;
  workspaceId: string;
  policy: ExecutionPolicyInstance;
  metaRequest: MessageInitShape<typeof SetMetadataRequestSchema>;
};

type DeletePolicy = {
  name: string;
  workspaceId: string;
};

function toConcurrencyPolicyInit(
  policy: ExecutionPolicyInstance["concurrencyPolicy"],
): MessageInitShape<typeof ConcurrencyPolicySchema> | undefined {
  if (!policy) return undefined;
  return { maxConcurrentExecutions: policy.maxConcurrentExecutions };
}

function normalizeComparableConcurrency(
  policy: { maxConcurrentExecutions?: number } | undefined,
): { maxConcurrentExecutions: number } | undefined {
  if (!policy || !policy.maxConcurrentExecutions) return undefined;
  return { maxConcurrentExecutions: policy.maxConcurrentExecutions };
}

/**
 * Validate a declared execution policy against the parser schema. Throws with
 * a descriptive error when `name` or `key` violates the platform grammar.
 * @param policy - Declared policy from the config
 */
function validatePolicy(policy: ExecutionPolicyInstance): void {
  const parsed = WorkflowJobFunctionExecutionPolicySchema.safeParse(policy);
  if (!parsed.success) {
    throw new Error(
      `Invalid workflow execution policy "${policy.name}": ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
}

/**
 * Plan workflow job function execution policy changes based on desired
 * declarations and current remote state.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param appName - Application name
 * @param appId - Application ID for ownership metadata
 * @param declared - Policies declared in the config (property name → instance)
 * @returns Planned execution policy changes
 */
export async function planWorkflowJobFunctionExecutionPolicy(
  client: OperatorClient,
  workspaceId: string,
  appName: string,
  appId: string | undefined,
  declared: Record<string, ExecutionPolicyInstance>,
) {
  const changeSet = createChangeSet<CreatePolicy, UpdatePolicy, DeletePolicy>(
    "Workflow execution policies",
  );
  const conflicts: OwnerConflict[] = [];
  const unmanaged: UnmanagedResource[] = [];
  const resourceOwners = new Set<string>();

  const declaredList = Object.values(declared);
  for (const policy of declaredList) {
    validatePolicy(policy);
  }

  const existing = await fetchExistingResourcesWithLabels({
    client,
    fetchPage: async (pageToken, pageSize) => {
      const response = await client.listWorkflowJobFunctionExecutionPolicies({
        workspaceId,
        pageToken,
        pageSize,
      });
      return [response.policies, response.nextPageToken];
    },
    getName: (resource) => resource.name,
    getTrn: (name) => resourceTrn(workspaceId, "workflow_job_function_execution_policy", name),
  });

  const seenNames = new Set<string>();
  for (const policy of declaredList) {
    if (seenNames.has(policy.name)) {
      throw new Error(
        `Duplicate workflow execution policy name "${policy.name}". Each policy must have a unique name within the workspace.`,
      );
    }
    seenNames.add(policy.name);

    const currentTrn = resourceTrn(
      workspaceId,
      "workflow_job_function_execution_policy",
      policy.name,
    );
    const metaRequest = await buildMetaRequest({ trn: currentTrn, appName, appId });
    const found = existing[policy.name];

    if (found) {
      const owned = trackDesiredResourceOwnership({
        labels: found.allLabels,
        ownerLabel: found.label,
        appName,
        appId,
        resourceType: "Workflow execution policy",
        resourceName: policy.name,
        conflicts,
        unmanaged,
      });

      const remoteKey = found.resource.executionPolicyKey;
      const remoteConcurrency = normalizeComparableConcurrency(found.resource.concurrencyPolicy);
      const desiredConcurrency = normalizeComparableConcurrency(policy.concurrencyPolicy);
      const unchanged =
        owned &&
        hasMatchingSdkVersion(found.allLabels, metaRequest.labels) &&
        remoteKey === policy.key &&
        areNormalizedEqual(remoteConcurrency, desiredConcurrency);

      if (unchanged) {
        changeSet.unchanged.push({ name: policy.name });
      } else if (remoteKey !== policy.key) {
        // execution_policy_key is immutable after create; recreate to switch it.
        changeSet.deletes.push({ name: policy.name, workspaceId });
        changeSet.creates.push({ name: policy.name, workspaceId, policy, metaRequest });
      } else {
        changeSet.updates.push({ name: policy.name, workspaceId, policy, metaRequest });
      }
      delete existing[policy.name];
    } else {
      changeSet.creates.push({ name: policy.name, workspaceId, policy, metaRequest });
    }
  }

  for (const [name, remaining] of Object.entries(existing)) {
    if (!remaining) continue;
    const owned = trackRemainingResourceOwner({
      labels: remaining.allLabels,
      ownerLabel: remaining.label,
      appName,
      appId,
      resourceOwners,
    });
    if (owned) {
      changeSet.deletes.push({ name, workspaceId });
    }
  }

  return { changeSet, conflicts, unmanaged, resourceOwners };
}

/**
 * Apply planned workflow execution policy changes for the given phase.
 * @param client - Operator client instance
 * @param plan - Result of `planWorkflowJobFunctionExecutionPolicy`
 * @param phase - Apply phase
 * @returns Promise that resolves when policies are applied
 */
export async function applyWorkflowJobFunctionExecutionPolicy(
  client: OperatorClient,
  plan: Awaited<ReturnType<typeof planWorkflowJobFunctionExecutionPolicy>>,
  phase: Extract<ApplyPhase, "create-update" | "delete"> = "create-update",
): Promise<void> {
  const { changeSet } = plan;
  if (phase === "create-update") {
    await Promise.all([
      ...changeSet.creates.map(async (create) => {
        await client.createWorkflowJobFunctionExecutionPolicy({
          workspaceId: create.workspaceId,
          executionPolicyName: create.policy.name,
          executionPolicyKey: create.policy.key,
          concurrencyPolicy: toConcurrencyPolicyInit(create.policy.concurrencyPolicy),
        });
        await client.setMetadata(create.metaRequest);
      }),
      ...changeSet.updates.map(async (update) => {
        await client.updateWorkflowJobFunctionExecutionPolicy({
          workspaceId: update.workspaceId,
          executionPolicyName: update.policy.name,
          concurrencyPolicy: toConcurrencyPolicyInit(update.policy.concurrencyPolicy),
        });
        await client.setMetadata(update.metaRequest);
      }),
    ]);
  } else {
    await Promise.all(
      changeSet.deletes.map((del) =>
        client.deleteWorkflowJobFunctionExecutionPolicy({
          workspaceId: del.workspaceId,
          executionPolicyName: del.name,
        }),
      ),
    );
  }
}
