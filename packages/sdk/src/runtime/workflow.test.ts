/**
 * Tests for `@tailor-platform/sdk/runtime/workflow` typed wrappers.
 */
import { aroundEach, describe, expect, expectTypeOf, test } from "vitest";
import * as workflow from "#/runtime/workflow";
import { cleanupMocks, injectMocks, mockWorkflow } from "#/vitest/mock";
import type { ExecutionPolicyKey } from "#/runtime/workflow";

describe("@tailor-platform/sdk/runtime/workflow", () => {
  aroundEach(async (runTest) => {
    injectMocks(globalThis);
    await runTest();
    cleanupMocks(globalThis);
  });

  test("triggerWorkflow forwards args and returns Promise<string>", async () => {
    using wf = mockWorkflow();
    wf.setTriggerHandler("exec-42");

    const promise = workflow.triggerWorkflow("my-workflow", { a: 1 });

    expectTypeOf(promise).toEqualTypeOf<Promise<string>>();
    await expect(promise).resolves.toBe("exec-42");
    expect(wf.triggerWorkflow.mock.calls).toEqual([["my-workflow", { a: 1 }]]);
  });

  test("triggerWorkflow forwards options", async () => {
    using wf = mockWorkflow();
    await workflow.triggerWorkflow(
      "my-workflow",
      { a: 1 },
      {
        authInvoker: { namespace: "ns", machineUserName: "mu" },
      },
    );

    expect(wf.triggerWorkflow.mock.calls[0]?.[2]).toEqual({
      authInvoker: { namespace: "ns", machineUserName: "mu" },
    });
  });

  test("resumeWorkflow forwards executionId and returns Promise<string>", async () => {
    using wf = mockWorkflow();
    wf.setResumeHandler("exec-resumed");

    const promise = workflow.resumeWorkflow("exec-1");

    expectTypeOf(promise).toEqualTypeOf<Promise<string>>();
    await expect(promise).resolves.toBe("exec-resumed");
    expect(wf.resumeWorkflow.mock.calls).toEqual([["exec-1"]]);
  });

  test("triggerJobFunction forwards and returns enqueued result", () => {
    using wf = mockWorkflow();
    wf.enqueueResult({ ok: true });

    const result = workflow.triggerJobFunction("my-job", { id: 1 });

    expect(result).toEqual({ ok: true });
    expect(wf.triggeredJobs).toEqual([{ jobName: "my-job", args: { id: 1 } }]);
  });

  test("triggerJobFunction forwards executionPolicyKey option", () => {
    using wf = mockWorkflow();
    wf.enqueueResult({ ok: true });

    const policyKey = "premium" as ExecutionPolicyKey;
    workflow.triggerJobFunction("my-job", { id: 1 }, { executionPolicyKey: policyKey });

    expect(wf.triggeredJobs).toEqual([
      { jobName: "my-job", args: { id: 1 }, options: { executionPolicyKey: "premium" } },
    ]);
    expect(wf.triggerJobFunction.mock.calls[0]?.[2]).toEqual({ executionPolicyKey: "premium" });
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

  describe("canonical aliases", () => {
    test("startWorkflow behaves as an alias of triggerWorkflow", async () => {
      using wf = mockWorkflow();
      wf.setTriggerHandler("exec-canonical");

      const promise = workflow.startWorkflow("my-workflow", { a: 1 });

      expectTypeOf(promise).toEqualTypeOf<Promise<string>>();
      await expect(promise).resolves.toBe("exec-canonical");
      expect(wf.startWorkflow.mock.calls).toEqual([["my-workflow", { a: 1 }]]);
      expect(wf.startWorkflow).toBe(wf.triggerWorkflow);
    });

    test("resumeWorkflowExecution behaves as an alias of resumeWorkflow", async () => {
      using wf = mockWorkflow();
      wf.setResumeHandler("exec-canonical-resumed");

      const promise = workflow.resumeWorkflowExecution("exec-1");

      expectTypeOf(promise).toEqualTypeOf<Promise<string>>();
      await expect(promise).resolves.toBe("exec-canonical-resumed");
      expect(wf.resumeWorkflowExecution.mock.calls).toEqual([["exec-1"]]);
      expect(wf.resumeWorkflowExecution).toBe(wf.resumeWorkflow);
    });

    test("startJobFunction behaves as an alias of triggerJobFunction", () => {
      using wf = mockWorkflow();
      wf.enqueueResult({ canonical: true });

      const result = workflow.startJobFunction("my-job", { id: 1 });

      expect(result).toEqual({ canonical: true });
      expect(wf.startJobFunction.mock.calls).toEqual([["my-job", { id: 1 }]]);
      expect(wf.startJobFunction).toBe(wf.triggerJobFunction);
    });

    test("calls through canonical and legacy names share the same call log", () => {
      using wf = mockWorkflow();
      wf.setJobHandler(() => ({ ok: true }));

      workflow.startJobFunction("job-a", { via: "canonical" });
      workflow.triggerJobFunction("job-b", { via: "legacy" });

      expect(wf.triggeredJobs).toEqual([
        { jobName: "job-a", args: { via: "canonical" } },
        { jobName: "job-b", args: { via: "legacy" } },
      ]);
    });
  });
});
