import { create } from "@bufbuild/protobuf";
import { WorkflowJobExecutionSchema } from "@tailor-platform/tailor-proto/workflow_resource_pb";
import { describe, expect, test } from "vitest";
import { toWorkflowJobExecutionInfo, workflowJobExecutionLabel } from "./transform";

describe("toWorkflowJobExecutionInfo", () => {
  test("reports a job function call with its place under the parent job", () => {
    const info = toWorkflowJobExecutionInfo(
      create(WorkflowJobExecutionSchema, {
        id: "job-2",
        kind: { case: "jobFunction", value: { name: "fetch" } },
        position: {
          parentWorkflowJobExecutionId: "job-1",
          callIndex: 2,
          branchIndex: 1,
          depth: 1,
        },
      }),
    );

    expect(info).toMatchObject({
      id: "job-2",
      kind: { type: "jobFunction", name: "fetch" },
      position: { parentJobExecutionId: "job-1", callIndex: 2, branchIndex: 1, depth: 1 },
    });
  });

  test("reports a wait with its key", () => {
    const info = toWorkflowJobExecutionInfo(
      create(WorkflowJobExecutionSchema, {
        id: "job-3",
        kind: { case: "wait", value: { key: "approval" } },
      }),
    );

    expect(info.kind).toEqual({ type: "wait", key: "approval" });
  });

  test("leaves the parent, call order and branch null on the main job", () => {
    const info = toWorkflowJobExecutionInfo(
      create(WorkflowJobExecutionSchema, {
        id: "job-1",
        kind: { case: "jobFunction", value: { name: "main" } },
        position: { depth: 0 },
      }),
    );

    expect(info.position).toEqual({
      parentJobExecutionId: null,
      callIndex: null,
      branchIndex: null,
      depth: 0,
    });
  });

  test("leaves out the stacked job name the Platform still sends", () => {
    const info = toWorkflowJobExecutionInfo(
      create(WorkflowJobExecutionSchema, {
        id: "job-2",
        stackedJobName: "main/fetch#2.1",
        kind: { case: "jobFunction", value: { name: "fetch" } },
      }),
    );

    expect(info).not.toHaveProperty("stackedJobName");
  });

  test("reports an unknown kind and a null position when the Platform sent neither", () => {
    const info = toWorkflowJobExecutionInfo(create(WorkflowJobExecutionSchema, { id: "job-4" }));

    expect(info.kind).toEqual({ type: "unknown" });
    expect(info.position).toBeNull();
  });
});

describe("workflowJobExecutionLabel", () => {
  test("names a job function call by the job function", () => {
    expect(
      workflowJobExecutionLabel({ id: "job-2", kind: { type: "jobFunction", name: "fetch" } }),
    ).toBe("fetch");
  });

  test("names a wait by its key", () => {
    expect(
      workflowJobExecutionLabel({ id: "job-3", kind: { type: "wait", key: "approval" } }),
    ).toBe("wait(approval)");
  });

  test("falls back to the id when the kind is unknown", () => {
    expect(workflowJobExecutionLabel({ id: "job-4", kind: { type: "unknown" } })).toBe("job-4");
  });
});
