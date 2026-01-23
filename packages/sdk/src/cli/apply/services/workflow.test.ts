import { describe, test, expect, vi, beforeEach } from "vitest";
import { sdkNameLabelKey } from "./label";
import { planWorkflow } from "./workflow";
import type { OperatorClient } from "@/cli/client";
import type { Workflow, WorkflowJob } from "@/parser/service/workflow";

// Mock node:fs and node:path
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("// mock script"),
  existsSync: vi.fn().mockReturnValue(true),
  readdirSync: vi.fn().mockReturnValue(["job1.js", "job2.js"]),
}));

vi.mock("node:path", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("node:path");
  return {
    ...original,
    join: vi.fn().mockImplementation((...args) => args.join("/")),
  };
});

// Mock configure/config
vi.mock("@/configure/config", () => ({
  getDistDir: vi.fn().mockReturnValue(".tailor-sdk"),
}));

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
vi.mock("./index", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const original = (await importOriginal()) as typeof import("./index");
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
    existingWorkflows: Array<{ id: string; name: string; label?: string }>,
  ): OperatorClient {
    return {
      listWorkflows: vi.fn().mockResolvedValue({
        workflows: existingWorkflows.map((w) => ({ id: w.id, name: w.name })),
        nextPageToken: "",
      }),
      getMetadata: vi.fn().mockImplementation(({ trn }: { trn: string }) => {
        const name = trn.split(":").pop();
        const workflow = existingWorkflows.find((w) => w.name === name);
        return {
          metadata: {
            labels: workflow?.label ? { [sdkNameLabelKey]: workflow.label } : {},
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

      const result = await planWorkflow(client, workspaceId, appName, workflows, mainJobDeps);

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

      const result = await planWorkflow(client, workspaceId, appName, workflows, mainJobDeps);

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

      const result = await planWorkflow(client, workspaceId, appName, {}, {});

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

      const result = await planWorkflow(client, workspaceId, appName, {}, {});

      expect(result.changeSet.deletes).toHaveLength(0);
    });

    test("workflow owned by different app is NOT deleted", async () => {
      const client = createMockClient([{ id: "1", name: "other-workflow", label: "other-app" }]);

      const result = await planWorkflow(client, workspaceId, appName, {}, {});

      expect(result.changeSet.deletes).toHaveLength(0);
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });

    test("mixed ownership - only delete own workflows", async () => {
      const client = createMockClient([
        { id: "1", name: "my-workflow", label: appName },
        { id: "2", name: "other-workflow", label: "other-app" },
        { id: "3", name: "unmanaged-workflow" }, // No label
      ]);

      const result = await planWorkflow(client, workspaceId, appName, {}, {});

      expect(result.changeSet.deletes).toHaveLength(1);
      expect(result.changeSet.deletes[0].name).toBe("my-workflow");
      expect(result.resourceOwners.has("other-app")).toBe(true);
    });
  });
});
