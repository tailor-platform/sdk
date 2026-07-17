/**
 * Tests for `@tailor-platform/sdk/runtime/workflow` typed wrappers.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import { workflow, type ExecutionPolicyKey, type PlatformWorkflowAPI } from "#/runtime/workflow";
import { cleanupMocks, injectMocks, mockWorkflow } from "#/vitest/mock";

describe("@tailor-platform/sdk/runtime/workflow", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("exposes the platform workflow API", () => {
    expectTypeOf(workflow).toExtend<PlatformWorkflowAPI>();
  });

  test("startWorkflow forwards args and returns Promise<string>", async () => {
    using wf = mockWorkflow();
    wf.setStartHandler("exec-42");

    const promise = workflow.startWorkflow("my-workflow", { a: 1 });

    expectTypeOf(promise).toEqualTypeOf<Promise<string>>();
    await expect(promise).resolves.toBe("exec-42");
    expect(wf.startWorkflow.mock.calls).toEqual([["my-workflow", { a: 1 }]]);
  });

  test("startWorkflow forwards options", async () => {
    using wf = mockWorkflow();
    await workflow.startWorkflow(
      "my-workflow",
      { a: 1 },
      {
        authInvoker: { namespace: "ns", machineUserName: "mu" },
      },
    );

    expect(wf.startWorkflow.mock.calls[0]?.[2]).toEqual({
      authInvoker: { namespace: "ns", machineUserName: "mu" },
    });
  });

  test("resumeWorkflowExecution forwards executionId and returns Promise<string>", async () => {
    using wf = mockWorkflow();
    wf.setResumeHandler("exec-resumed");

    const promise = workflow.resumeWorkflowExecution("exec-1");

    expectTypeOf(promise).toEqualTypeOf<Promise<string>>();
    await expect(promise).resolves.toBe("exec-resumed");
    expect(wf.resumeWorkflowExecution.mock.calls).toEqual([["exec-1"]]);
  });

  test("startJobFunction forwards and returns enqueued result", () => {
    using wf = mockWorkflow();
    wf.enqueueResult({ ok: true });

    const result = workflow.startJobFunction("my-job", { id: 1 });

    expect(result).toEqual({ ok: true });
    expect(wf.startedJobs).toEqual([{ jobName: "my-job", args: { id: 1 } }]);
  });

  test("startJobFunction forwards executionPolicyKey option", () => {
    using wf = mockWorkflow();
    wf.enqueueResult({ ok: true });

    const policyKey = "premium" as ExecutionPolicyKey;
    workflow.startJobFunction("my-job", { id: 1 }, { executionPolicyKey: policyKey });

    expect(wf.startedJobs).toEqual([
      { jobName: "my-job", args: { id: 1 }, options: { executionPolicyKey: "premium" } },
    ]);
    expect(wf.startJobFunction.mock.calls[0]?.[2]).toEqual({ executionPolicyKey: "premium" });
  });

  test("wait records the call and returns the configured result", () => {
    using wf = mockWorkflow();
    wf.setWaitHandler({ resumed: true });

    const result = workflow.wait("key-1", { p: 1 });

    expect(result).toEqual({ resumed: true });
    expect(wf.waitCalls).toEqual([{ key: "key-1", payload: { p: 1 } }]);
  });

  test("resolve records the call without invoking the callback", async () => {
    using wf = mockWorkflow();
    let invoked = false;
    await workflow.resolve("exec-1", "key-1", () => {
      invoked = true;
    });

    expect(invoked).toBe(false);
    expect(wf.resolve).toHaveBeenCalledTimes(1);
    expect(wf.resolveCalls).toEqual([{ executionId: "exec-1", key: "key-1" }]);
  });
});
