import { Code, ConnectError } from "@connectrpc/connect";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { logger } from "#/cli/shared/logger";
import { sdkNameLabelKey } from "./label";
import { applyWorkflow, formatWorkflowChangeEntries, planWorkflow } from "./workflow";
import type { OperatorClient } from "#/cli/shared/client";
import type { Workflow, WorkflowJob } from "#/types/workflow.generated";

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
      lines: () => [],
    }),
  };
});

describe("planWorkflow", () => {
  const workspaceId = "test-workspace";
  const appName = "test-app";

  function createMockJob(name: string): WorkflowJob {
    return {
      name,
      trigger: () => {},
      body: () => {},
    };
  }

  function createMockWorkflow(name: string, mainJobName: string): Workflow {
    return {
      name,
      mainJob: createMockJob(mainJobName),
    };
  }

  function createMockClient(
    existingWorkflows: Array<{
      id: string;
      name: string;
      label?: string;
      resource?: Record<string, unknown>;
      sdkVersion?: string;
    }>,
    jobFunctionLabels?: Record<string, { label?: string; sdkVersion?: string }>,
  ): OperatorClient {
    const inferredJobFunctionLabels: Record<string, { label?: string; sdkVersion?: string }> = {};
    for (const workflow of existingWorkflows) {
      const resource = workflow.resource;
      if (!resource) {
        continue;
      }
      const jobFunctions = resource.jobFunctions;
      if (jobFunctions && typeof jobFunctions === "object" && !Array.isArray(jobFunctions)) {
        for (const jobName of Object.keys(jobFunctions)) {
          inferredJobFunctionLabels[jobName] = {
            label: workflow.label,
            sdkVersion: workflow.sdkVersion,
          };
        }
      }
      if (typeof resource.mainJobFunctionName === "string") {
        inferredJobFunctionLabels[resource.mainJobFunctionName] = {
          label: workflow.label,
          sdkVersion: workflow.sdkVersion,
        };
      }
    }
    const labelsByJobFunction = { ...inferredJobFunctionLabels, ...jobFunctionLabels };

    return {
      listWorkflows: vi.fn().mockResolvedValue({
        workflows: existingWorkflows.map((w) => w.resource ?? { id: w.id, name: w.name }),
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const jobFunctionPrefix = `trn:v1:workspace:${workspaceId}:workflow_job_function:`;
        if (trn.startsWith(jobFunctionPrefix)) {
          const name = trn.slice(jobFunctionPrefix.length);
          const jobFunction = labelsByJobFunction[name]!;
          return {
            metadata: {
              labels: jobFunction.label
                ? {
                    [sdkNameLabelKey]: jobFunction.label,
                    "sdk-version": jobFunction.sdkVersion ?? "v1-0-0",
                  }
                : {},
            },
          };
        }

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
        jobFunctions: Object.keys(labelsByJobFunction).map((name) => ({ name })),
        nextPageToken: "",
      }),
    } as unknown as OperatorClient;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rename scenarios", () => {
    test("old workflow is deleted when renamed", async () => {
      const client = createMockClient([{ id: "1", name: "old-workflow", label: appName }]);

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
        undefined,
        workflows,
        mainJobDeps,
      );

      expect(result.changeSet.creates).toHaveLength(1);
      expect(result.changeSet.creates[0]!.name).toBe("new-workflow");

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("old-workflow");
    });
  });

  describe("delete scenarios", () => {
    test("workflow is deleted when removed from config", async () => {
      const client = createMockClient([
        { id: "1", name: "workflow-a", label: appName },
        { id: "2", name: "workflow-b", label: appName },
      ]);

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
        undefined,
        workflows,
        mainJobDeps,
      );

      expect(result.changeSet.updates).toHaveLength(1);
      expect(result.changeSet.updates[0]!.name).toBe("workflow-a");

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("workflow-b");
    });

    test("all workflows are deleted when config is empty", async () => {
      const client = createMockClient([
        {
          id: "1",
          name: "workflow-1",
          label: appName,
          resource: {
            id: "1",
            name: "workflow-1",
            mainJobFunctionName: "main-job-1",
            jobFunctions: {
              "main-job-1": "1",
              "child-job-1": "1",
            },
          },
        },
        {
          id: "2",
          name: "workflow-2",
          label: appName,
          resource: {
            id: "2",
            name: "workflow-2",
            mainJobFunctionName: "main-job-2",
            jobFunctions: {
              "main-job-2": "1",
            },
          },
        },
      ]);

      const result = await planWorkflow(client, workspaceId, appName, undefined, {}, {});

      expect(result.changeSet.deletes).toHaveLength(2);
      expect(result.changeSet.deletes.map((d) => d.name).toSorted()).toEqual([
        "workflow-1",
        "workflow-2",
      ]);
      expect(result.changeSet.deletes.find((d) => d.name === "workflow-1")).toHaveProperty(
        "deletableJobNames",
        ["child-job-1", "main-job-1"],
      );
      expect(result.changeSet.deletes.find((d) => d.name === "workflow-2")).toHaveProperty(
        "deletableJobNames",
        ["main-job-2"],
      );
    });

    test("job functions still referenced by retained workflows are not deleted", async () => {
      const client = createMockClient([
        {
          id: "1",
          name: "removed-workflow",
          label: appName,
          resource: {
            id: "1",
            name: "removed-workflow",
            mainJobFunctionName: "removed-job",
            jobFunctions: {
              "removed-job": "1",
              "shared-job": "1",
            },
          },
        },
        {
          id: "2",
          name: "kept-workflow",
          label: appName,
          resource: {
            id: "2",
            name: "kept-workflow",
            mainJobFunctionName: "shared-job",
            jobFunctions: {
              "shared-job": "1",
            },
          },
        },
        {
          id: "3",
          name: "other-workflow",
          label: "other-app",
          resource: {
            id: "3",
            name: "other-workflow",
            mainJobFunctionName: "other-shared-job",
            jobFunctions: {
              "other-shared-job": "1",
              "other-only-job": "1",
            },
          },
        },
      ]);

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        undefined,
        {
          "kept-workflow": createMockWorkflow("kept-workflow", "shared-job"),
        },
        {
          "shared-job": ["shared-job"],
        },
      );

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("removed-workflow");
      expect(result.changeSet.deletes[0]!.usedJobNames).toEqual(["removed-job", "shared-job"]);
      expect(result.changeSet.deletes[0]!).toHaveProperty("deletableJobNames", ["removed-job"]);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("job functions referenced by other owners are not deleted", async () => {
      const client = createMockClient([
        {
          id: "1",
          name: "removed-workflow",
          label: appName,
          resource: {
            id: "1",
            name: "removed-workflow",
            mainJobFunctionName: "shared-job",
            jobFunctions: {
              "shared-job": "1",
            },
          },
        },
        {
          id: "2",
          name: "other-workflow",
          label: "other-app",
          resource: {
            id: "2",
            name: "other-workflow",
            mainJobFunctionName: "shared-job",
            jobFunctions: {
              "shared-job": "1",
            },
          },
        },
      ]);

      const result = await planWorkflow(client, workspaceId, appName, undefined, {}, {});

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("removed-workflow");
      expect(result.changeSet.deletes[0]!).toHaveProperty("deletableJobNames", []);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("job functions owned by another app are not deleted", async () => {
      const client = createMockClient(
        [
          {
            id: "1",
            name: "removed-workflow",
            label: appName,
            resource: {
              id: "1",
              name: "removed-workflow",
              mainJobFunctionName: "foreign-job",
              jobFunctions: {
                "foreign-job": "1",
              },
            },
          },
        ],
        {
          "foreign-job": { label: "other-app" },
        },
      );

      const result = await planWorkflow(client, workspaceId, appName, undefined, {}, {});

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("removed-workflow");
      expect(result.changeSet.deletes[0]!).toHaveProperty("deletableJobNames", []);
    });
  });

  describe("label ownership scenarios", () => {
    test.each([
      ["workflow without label is NOT deleted", { name: "unmanaged-workflow" }, false],
      [
        "workflow owned by different app is NOT deleted",
        { name: "other-workflow", label: "other-app" },
        true,
      ],
    ])("%s", async (_name, workflow, expectOtherAppOwner) => {
      const client = createMockClient([{ id: "1", ...workflow }]);

      const result = await planWorkflow(client, workspaceId, appName, undefined, {}, {});

      expect(result.changeSet.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(expectOtherAppOwner);
    });

    test("mixed ownership - only delete own workflows", async () => {
      const client = createMockClient([
        { id: "1", name: "my-workflow", label: appName },
        { id: "2", name: "other-workflow", label: "other-app" },
        { id: "3", name: "unmanaged-workflow" }, // No label
      ]);

      const result = await planWorkflow(client, workspaceId, appName, undefined, {}, {});

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0]!.name).toBe("my-workflow");
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
        undefined,
        workflows,
        mainJobDeps,
        new Set(["validate-order", "check-inventory", "process-payment"]),
      );

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0]!.name).toBe("sample-workflow");
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
        undefined,
        workflows,
        mainJobDeps,
        new Set(["process-order", "fetch-customer", "send-notification"]),
      );

      expect(result.changeSet.unchanged).toHaveLength(1);
      expect(result.changeSet.unchanged[0]!.name).toBe("order-processing");
      expect(result.changeSet.updates).toHaveLength(0);
    });

    test.each([
      ["matches local value", "is unchanged", 5, ["batch-processing"], []],
      ["differs", "is updated", 10, [], ["batch-processing"]],
    ])(
      "workflow with concurrencyPolicy %s when remote maxConcurrentExecutions %s",
      async (
        _label,
        _outcome,
        localMaxConcurrentExecutions,
        expectedUnchanged,
        expectedUpdates,
      ) => {
        const client = createMockClient([
          {
            id: "1",
            name: "batch-processing",
            label: appName,
            resource: {
              id: "1",
              name: "batch-processing",
              mainJobFunctionName: "run-batch",
              jobFunctions: {
                "run-batch": "5",
              },
              concurrencyPolicy: {
                maxConcurrentExecutions: 5,
              },
            },
          },
        ]);

        const workflow = createMockWorkflow("batch-processing", "run-batch");
        workflow.concurrencyPolicy = {
          maxConcurrentExecutions: localMaxConcurrentExecutions,
        };

        const workflows = {
          "batch-processing": workflow,
        };
        const mainJobDeps = {
          "run-batch": ["run-batch"],
        };

        const result = await planWorkflow(
          client,
          workspaceId,
          appName,
          undefined,
          workflows,
          mainJobDeps,
          new Set(["run-batch"]),
        );

        expect(result.changeSet.unchanged.map((u) => u.name)).toEqual(expectedUnchanged);
        expect(result.changeSet.updates.map((u) => u.name)).toEqual(expectedUpdates);
      },
    );

    test("plans owned orphaned job functions for deletion even when remaining workflows are unchanged", async () => {
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

      const client = {
        listWorkflows: vi.fn().mockResolvedValue({
          workflows: [
            {
              id: "workflow-1",
              name: "kept-workflow",
              mainJobFunctionName: "keep-job",
              jobFunctions: {
                "keep-job": "1",
              },
            },
          ],
          nextPageToken: "",
        }),
        listWorkflowJobFunctions,
        getMetadata,
      } as unknown as OperatorClient;

      const result = await planWorkflow(
        client,
        workspaceId,
        appName,
        undefined,
        {
          "kept-workflow": createMockWorkflow("kept-workflow", "keep-job"),
        },
        {
          "keep-job": ["keep-job"],
        },
        new Set(["keep-job"]),
      );

      expect(listWorkflowJobFunctions).toHaveBeenCalledWith({
        workspaceId,
        pageToken: "",
        pageSize: 100,
      });
      expect(result.jobFunctionDeletes).toEqual([{ workspaceId, jobFunctionName: "orphaned-job" }]);
    });
  });

  describe("apply phase separation", () => {
    test("delete phase deletes job functions after their workflows", async () => {
      const deleteWorkflow = vi.fn().mockResolvedValue({});
      const deleteWorkflowJobFunction = vi.fn().mockResolvedValue({});
      const client = {
        deleteWorkflow,
        deleteWorkflowJobFunction,
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
                usedJobNames: ["removed-job", "shared-job"],
                deletableJobNames: ["removed-job"],
              },
            ],
            replaces: [],
            unchanged: [],
            isEmpty: () => false,
            lines: () => [],
          },
          jobFunctionDeletes: [{ workspaceId, jobFunctionName: "removed-job" }],
          conflicts: [],
          unmanaged: [],
          resourceOwners: new Set<string>(),
          appName,
          appId: undefined,
          unchangedWorkflowJobNames: new Set<string>(),
        } as unknown as Awaited<ReturnType<typeof planWorkflow>>,
        "delete",
      );

      expect(deleteWorkflow).toHaveBeenCalledWith({
        workspaceId,
        workflowId: "workflow-1",
      });
      expect(deleteWorkflowJobFunction).toHaveBeenCalledTimes(1);
      expect(deleteWorkflowJobFunction).toHaveBeenCalledWith({
        workspaceId,
        jobFunctionName: "removed-job",
      });
      expect(deleteWorkflow.mock.invocationCallOrder[0]!).toBeLessThan(
        deleteWorkflowJobFunction.mock.invocationCallOrder[0]!,
      );
    });

    test("delete phase continues deletions and tolerates terminal platform states", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const deleteWorkflow = vi
        .fn()
        .mockRejectedValueOnce(new ConnectError("gone", Code.NotFound))
        .mockResolvedValueOnce({});
      const deleteWorkflowJobFunction = vi
        .fn()
        .mockRejectedValueOnce(new ConnectError("still referenced", Code.FailedPrecondition))
        .mockRejectedValueOnce(new ConnectError("gone", Code.NotFound))
        .mockResolvedValueOnce({});
      const client = {
        deleteWorkflow,
        deleteWorkflowJobFunction,
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
                name: "removed-a",
                workspaceId,
                workflowId: "workflow-a",
                usedJobNames: ["job-a"],
                deletableJobNames: ["job-a"],
              },
              {
                name: "removed-b",
                workspaceId,
                workflowId: "workflow-b",
                usedJobNames: ["job-b"],
                deletableJobNames: ["job-b"],
              },
            ],
            replaces: [],
            unchanged: [],
            isEmpty: () => false,
            lines: () => [],
          },
          jobFunctionDeletes: [
            { workspaceId, jobFunctionName: "job-a" },
            { workspaceId, jobFunctionName: "job-b" },
            { workspaceId, jobFunctionName: "job-c" },
          ],
          conflicts: [],
          unmanaged: [],
          resourceOwners: new Set<string>(),
          appName,
          appId: undefined,
          unchangedWorkflowJobNames: new Set<string>(),
        } as unknown as Awaited<ReturnType<typeof planWorkflow>>,
        "delete",
      );

      expect(deleteWorkflow).toHaveBeenCalledTimes(2);
      expect(deleteWorkflowJobFunction).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledWith(
        'Skipped deleting workflow job function "job-a" because it is still referenced.',
      );
      warn.mockRestore();
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
        labels: ["workflow", "function"],
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
        labels: ["function"],
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
            deletableJobNames: ["process-order", "send-notification"],
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
        labels: ["workflow", "function"],
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
            deletableJobNames: ["process-order"],
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
        labels: ["function"],
      },
    ]);
  });
});
