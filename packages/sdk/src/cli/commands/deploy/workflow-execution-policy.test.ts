import { describe, expect, test } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import {
  defineWorkflowExecutionPolicies,
  defineWorkflowExecutionPolicy,
} from "#/configure/services/workflow/execution-policy";
import { buildMetaRequest, resourceTrn, sdkVersionLabelKey } from "./label";
import {
  planWorkflowJobFunctionExecutionPolicy,
  toPlatformExecutionPolicyKey,
} from "./workflow-execution-policy";

describe("toPlatformExecutionPolicyKey", () => {
  test("returns key unchanged for an exact-match policy", () => {
    const policy = defineWorkflowExecutionPolicy("premium");
    expect(toPlatformExecutionPolicyKey(policy)).toBe("premium");
  });

  test("appends a trailing `*` for a policy declared with matchType: 'prefix'", () => {
    const policy = defineWorkflowExecutionPolicy("tenant-api", { matchType: "prefix" });
    expect(toPlatformExecutionPolicyKey(policy)).toBe("tenant-api*");
  });

  test("appends a trailing `*` when matchType: 'prefix' is combined with an explicit key", () => {
    const policies = defineWorkflowExecutionPolicies((define) => ({
      // key deliberately differs from name to show it's used independently.
      tenantApi: define({ name: "tenant-api", key: "tenant_api", matchType: "prefix" }),
    }));
    expect(toPlatformExecutionPolicyKey(policies.tenantApi)).toBe("tenant_api*");
  });
});

describe("planWorkflowJobFunctionExecutionPolicy", () => {
  test("rejects a declared key that already ends with '*', regardless of matchType", async () => {
    const policy = defineWorkflowExecutionPolicy("tenant-api", { key: "tenant-api*" });
    await expect(
      // Validation runs before the client is touched, so an empty stub suffices.
      planWorkflowJobFunctionExecutionPolicy(
        mockOperatorClient({}),
        "ws-id",
        { kind: "application", name: "app", id: undefined },
        {
          tenantApi: policy,
        },
      ),
    ).rejects.toThrow(/key must not end with '\*'/);
  });

  test("rejects a hand-constructed prefix policy missing the internal key", async () => {
    // ExecutionPolicyWildcardInstance's public type has no `key`, so nothing
    // stops a caller from hand-constructing one that skips the builder and
    // genuinely lacks the internal prefix.
    const policy = { name: "tenant-api", matchType: "prefix", keyFor: () => "" } as never;
    await expect(
      planWorkflowJobFunctionExecutionPolicy(
        mockOperatorClient({}),
        "ws-id",
        { kind: "application", name: "app", id: undefined },
        {
          tenantApi: policy,
        },
      ),
    ).rejects.toThrow(/must be created via defineWorkflowExecutionPolicy/);
  });
});

describe("planWorkflowJobFunctionExecutionPolicy SDK-version-forced updates", () => {
  const workspaceId = "ws-id";
  const appName = "app";

  async function planPremium(options: {
    remoteMaxConcurrentExecutions: number;
    owner?: string;
    staleSdkVersion?: boolean;
    appId?: string;
  }) {
    const { labels } = await buildMetaRequest({
      trn: resourceTrn(workspaceId, "workflow_job_function_execution_policy", "premium"),
      owner: { kind: "application", name: appName, id: options.appId },
    });
    const client = mockOperatorClient({
      listWorkflowJobFunctionExecutionPolicies: {
        policies: [
          {
            name: "premium",
            executionPolicyKey: "premium",
            concurrencyPolicy: { maxConcurrentExecutions: options.remoteMaxConcurrentExecutions },
          },
        ],
        nextPageToken: "",
      },
      getMetadata: {
        metadata: {
          labels: {
            ...labels,
            "sdk-name": options.owner ?? appName,
            ...(options.staleSdkVersion && { [sdkVersionLabelKey]: "v0-0-0" }),
          },
        },
      },
    });

    return planWorkflowJobFunctionExecutionPolicy(
      client,
      workspaceId,
      { kind: "application", name: appName, id: options.appId },
      {
        premium: defineWorkflowExecutionPolicy("premium", {
          concurrencyPolicy: { maxConcurrentExecutions: 3 },
        }),
      },
    );
  }

  test.each([
    { name: "only its sdk-version differs", remoteMax: 3, staleSdkVersion: true, forced: true },
    { name: "its concurrency also differs", remoteMax: 5, staleSdkVersion: true, forced: false },
    { name: "another app owns it", remoteMax: 3, owner: "other-app", forced: false },
  ])("marks a policy update forced only when $name", async ({ remoteMax, forced, ...rest }) => {
    const result = await planPremium({ remoteMaxConcurrentExecutions: remoteMax, ...rest });

    expect(result.changeSet.updates).toHaveLength(1);
    expect(result.changeSet.updates[0]?.forcedBySdkVersion).toBe(forced ? true : undefined);
  });

  test("refreshes the labels of an unchanged policy whose other SDK labels differ", async () => {
    const result = await planPremium({
      remoteMaxConcurrentExecutions: 3,
      owner: "old-name",
      appId: "app-1",
    });

    expect(result.changeSet.updates).toEqual([]);
    expect(result.changeSet.unchanged).toEqual([
      {
        name: "premium",
        labelRefresh: expect.objectContaining({
          labels: expect.objectContaining({ "sdk-name": appName }),
        }),
      },
    ]);
  });

  test("reports a policy owned by another app with its resource type and label", async () => {
    const result = await planPremium({ remoteMaxConcurrentExecutions: 3, owner: "other-app" });

    expect(result.conflicts).toEqual([
      {
        resourceType: "workflow_job_function_execution_policy",
        resourceLabel: "Workflow execution policy",
        resourceName: "premium",
        currentOwner: "other-app",
      },
    ]);
  });
});
