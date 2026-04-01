import { describe, test, expect, vi, beforeEach } from "vitest";
import { sdkNameLabelKey } from "./label";
import { applyWorkflow, formatWorkflowChangeEntries, planWorkflow } from "./workflow";
import type { RelatedFunctionRegistryChanges } from "./grouped-display";
import type { OperatorClient } from "@/cli/shared/client";
import type { Workflow, WorkflowJob } from "@/types/workflow.generated";

const emptyFunctionRegistryChanges: RelatedFunctionRegistryChanges = {
  creates: [],
  updates: [],
  deletes: [],
  replaces: [],
};

// Mock label.ts
vi.mock("./label", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./label");
  return {
    ...original,
    buildMetaRequest: vi.fn().mockResolvedValue({
      trn: "trn:v1:workspace:test-workspace:workflow:test",
      labels: {
        "sdk-name": "test-app",
        "sdk-version": "v1-0-0",
      },
    }),
  };
});

// Mock createChangeSet to suppress output in tests
vi.mock("./change-set", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./change-set");
  return {
    ...original,
    createChangeSet: (title: string) => ({
      ...original.createChangeSet(title),
      print: () => {},
    }),
  };
});

describe("planWorkflow", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  // Helper to create mock workflow job
  function createMockJob(name: string): WorkflowJob {
    return {
      name,
      trigger: () => {},
      body: () => {},
    };
  }

  // Helper to create mock workflow
  function createMockWorkflow(name: string, mainJobName: string): Workflow {
    return {
      name,
      mainJob: createMockJob(mainJobName),
    };
  }

  // Helper to create mock client
  function createMockClient(
    existingWorkflows: Array<{
      id: string;
      name: string;
      label?: string;
      resource?: Record<string, unknown>;
      sdkVersion?: string;
    }>,
  ): OperatorClient {
    return {
      listWorkflows: vi.fn().mockResolvedValue({
        workflows: existingWorkflows.map((w) => w.resource ?? { id: w.id, name: w.name }),
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const name = trn.split(":").pop();
        const workflow = existingWorkflows.find((w) => w.name === name);
        return {
          metadata: {
            labels: workflow?.label
              ? {
                  [sdkNameLabelKey]: workflow.label,
                  "sdk-version": workflow.sdkVersion ?? "v1-0-0",
                }
              : {},
          },
        };
      }),
      listWorkflowJobFunctions: vi.fn().mockResolvedValue({
        jobFunctions: [],
        nextPageToken: "",
      }),
    } as unknown as OperatorClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rename scenarios", () => {
    test("old workflow is deleted when renamed", async () => {
      // Existing workflow: "old-workflow" with app label
      const client = createMockClient([{ id: "1", name: "old-workflow", label: appName }]);

      // New config has "new-workflow" (renamed)
      const workflows = {
        "new-workflow": createMockWorkflow("new-workflow", "main-job"),
      };

      const mainJobDeps = {
        "main-job": ["main-job"],
      };

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        workflows,
        mainJobDeps,
        new Set(),
        emptyFunctionRegistryChanges,
      );

      // "new-workflow" should be created
      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0].name).toBe("new-workflow");

      // "old-workflow" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("old-workflow");
    });
  });

  describe("delete scenarios", () => {
    test("workflow is deleted when removed from config", async () => {
      const client = createMockClient([
        { id: "1", name: "workflow-a", label: appName },
        { id: "2", name: "workflow-b", label: appName },
      ]);

      // Only workflow-a in config
      const workflows = {
        "workflow-a": createMockWorkflow("workflow-a", "job-a"),
      };

      const mainJobDeps = {
        "job-a": ["job-a"],
      };

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        workflows,
        mainJobDeps,
        new Set(),
        emptyFunctionRegistryChanges,
      );

      // "workflow-a" should be updated
      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0].name).toBe("workflow-a");

      // "workflow-b" should be deleted
      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("workflow-b");
    });

    test("all workflows are deleted when config is empty", async () => {
      const client = createMockClient([
        { id: "1", name: "workflow-1", label: appName },
        { id: "2", name: "workflow-2", label: appName },
      ]);

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        {},
        {},
        new Set(),
        emptyFunctionRegistryChanges,
      );

      expect(result.changeSet.deletes).toHaveLength(2);
      expect(result.changeSet.deletes.map((d) => d.name).sort()).toEqual([
        "workflow-1",
        "workflow-2",
      ]);
    });
  });

  describe("label ownership scenarios", () => {
    test("workflow without label is NOT deleted", async () => {
      const client = createMockClient([
        { id: "1", name: "unmanaged-workflow" }, // No label
      ]);

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        {},
        {},
        new Set(),
        emptyFunctionRegistryChanges,
      );

      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("workflow owned by different app is NOT deleted", async () => {
      const client = createMockClient([{ id: "1", name: "other-workflow", label: "other-app" }]);

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        {},
        {},
        new Set(),
        emptyFunctionRegistryChanges,
      );

      expect(result.changeSet.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own workflows", async () => {
      const client = createMockClient([
        { id: "1", name: "my-workflow", label: appName },
        { id: "2", name: "other-workflow", label: "other-app" },
        { id: "3", name: "unmanaged-workflow" }, // No label
      ]);

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        {},
        {},
        new Set(),
        emptyFunctionRegistryChanges,
      );

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("my-workflow");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
  });

  describe("no-op detection", () => {
    test("workflow is unchanged when definition and job functions match unchanged registry entries", async () => {
      const client = createMockClient([
        {
          id: "1",
          name: "sample-workflow",
          label: appName,
          resource: {
            id: "1",
            name: "sample-workflow",
            mainJobFunctionName: "validate-order",
            jobFunctions: {
              "check-inventory": "5",
              "process-payment": "5",
              "validate-order": "5",
            },
          },
        },
      ]);

      const workflows = {
        "sample-workflow": createMockWorkflow("sample-workflow", "validate-order"),
      };
      const mainJobDeps = {
        "validate-order": ["validate-order", "check-inventory", "process-payment"],
      };

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        workflows,
        mainJobDeps,
        new Set(["validate-order", "check-inventory", "process-payment"]),
        emptyFunctionRegistryChanges,
      );

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0].name).toBe("sample-workflow");
      expect(result.changeSet.updates).toHaveLength(0);
    });

    test("workflow with retryPolicy is unchanged when remote bigint durations match local parsed durations", async () => {
      const client = createMockClient([
        {
          id: "1",
          name: "order-processing",
          label: appName,
          resource: {
            id: "1",
            name: "order-processing",
            mainJobFunctionName: "process-order",
            jobFunctions: {
              "fetch-customer": "5",
              "send-notification": "5",
              "process-order": "5",
            },
            retryPolicy: {
              maxRetries: 3,
              backoffMultiplier: 2,
              initialBackoff: {
                seconds: 1n,
                nanos: 0,
              },
              maxBackoff: {
                seconds: 30n,
                nanos: 0,
              },
            },
          },
        },
      ]);

      const workflow = createMockWorkflow("order-processing", "process-order");
      workflow.retryPolicy = {
        maxRetries: 3,
        initialBackoff: "1s",
        maxBackoff: "30s",
        backoffMultiplier: 2,
      };

      const workflows = {
        "order-processing": workflow,
      };
      const mainJobDeps = {
        "process-order": ["process-order", "fetch-customer", "send-notification"],
      };

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        workflows,
        mainJobDeps,
        new Set(["process-order", "fetch-customer", "send-notification"]),
        emptyFunctionRegistryChanges,
      );

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0].name).toBe("order-processing");
      expect(result.changeSet.updates).toHaveLength(0);
    });

    test("removes metadata from orphaned job functions even when remaining workflows are unchanged", async () => {
      const listWorkflowJobFunctions = vi.fn().mockResolvedValue({
        jobFunctions: [{ name: "keep-job" }, { name: "orphaned-job" }],
        nextPageToken: "",
      });
      const getMetadata = vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const jobName = trn.split(":").pop();
        return {
          metadata: {
            labels:
              jobName === "orphaned-job"
                ? { [sdkNameLabelKey]: appName, "sdk-version": "v1-0-0" }
                : { [sdkNameLabelKey]: "other-app", "sdk-version": "v1-0-0" },
          },
        };
      });
      const setMetadata = vi.fn().mockResolvedValue(undefined);

      const client = {
        listWorkflowJobFunctions,
        getMetadata,
        setMetadata,
        createWorkflowJobFunction: vi.fn(),
        updateWorkflowJobFunction: vi.fn(),
      } as unknown as OperatorClient;

      await applyWorkflow(
        client,
        {
          changeSet: {
            title: "Workflows",
            creates: [],
            updates: [],
            deletes: [
              {
                name: "removed-workflow",
                workspaceId,
                workflowId: "workflow-1",
                usedJobNames: ["removed-job"],
              },
            ],
            replaces: [],
            unchanged: [{ name: "kept-workflow" }],
            isEmpty: () => false,
            print: () => {},
          },
          conflicts: [],
          unmanaged: [],
          resourceOwners: new Set<string>(),
          appName,
          unchangedWorkflowJobNames: new Set(["keep-job"]),
        },
        "create-update",
      );

      expect(listWorkflowJobFunctions).toHaveBeenCalledWith({
        workspaceId,
        pageToken: "",
        pageSize: 1000,
      });
      expect(setMetadata).toHaveBeenCalledTimes(1);
      expect(setMetadata).toHaveBeenCalledWith({
        trn: `trn:v1:workspace:${workspaceId}:workflow_job_function:orphaned-job`,
        labels: { [sdkNameLabelKey]: "" },
      });
    });
  });
});

describe("formatWorkflowChangeEntries", () => {
  test("groups workflow updates with related workflow job function updates", () => {
    const entries = formatWorkflowChangeEntries(
      {
        creates: [],
        updates: [
          {
            name: "order-processing",
            workspaceId: "ws",
            workflow: {
              name: "order-processing",
              mainJob: { name: "process-order", body: () => {}, trigger: () => {} },
            },
            usedJobNames: ["process-order"],
            metaRequest: { trn: "t", labels: {} },
          },
        ],
        deletes: [],
        replaces: [],
      },
      {
        creates: [],
        updates: [{ name: "workflow--process-order" }],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "update",
        symbol: "~",
        name: "order-processing",
        labels: ["workflow", "functionRegistry"],
      },
    ]);
  });

  test("keeps unrelated workflow job function changes visible", () => {
    const entries = formatWorkflowChangeEntries(
      {
        creates: [],
        updates: [],
        deletes: [],
        replaces: [],
      },
      {
        creates: [],
        updates: [{ name: "workflow--process-order" }],
        deletes: [],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "update",
        symbol: "~",
        name: "process-order",
        labels: ["functionRegistry"],
      },
    ]);
  });

  test("groups workflow deletes with related function registry deletes", () => {
    const entries = formatWorkflowChangeEntries(
      {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "order-processing",
            workspaceId: "ws",
            workflowId: "workflow-1",
            usedJobNames: ["process-order", "send-notification"],
          },
        ],
        replaces: [],
      },
      {
        creates: [],
        updates: [],
        deletes: [{ name: "workflow--process-order" }, { name: "workflow--send-notification" }],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "delete",
        symbol: "-",
        name: "order-processing",
        labels: ["workflow", "functionRegistry"],
      },
    ]);
  });

  test("keeps unrelated workflow function deletes visible", () => {
    const entries = formatWorkflowChangeEntries(
      {
        creates: [],
        updates: [],
        deletes: [
          {
            name: "order-processing",
            workspaceId: "ws",
            workflowId: "workflow-1",
            usedJobNames: ["process-order"],
          },
        ],
        replaces: [],
      },
      {
        creates: [],
        updates: [],
        deletes: [{ name: "workflow--send-notification" }],
        replaces: [],
      },
    );

    expect(entries).toEqual([
      {
        action: "delete",
        symbol: "-",
        name: "order-processing",
        labels: ["workflow"],
      },
      {
        action: "delete",
        symbol: "-",
        name: "send-notification",
        labels: ["functionRegistry"],
      },
    ]);
  });
});
