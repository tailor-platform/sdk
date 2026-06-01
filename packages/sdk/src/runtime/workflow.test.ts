/**
 * Tests for `@tailor-platform/sdk/runtime/workflow` typed wrappers.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, test } from "vitest";
import * as workflow from "@/runtime/workflow";
import { cleanupMocks, injectMocks, workflowMock } from "@/vitest/mock";

describe("@tailor-platform/sdk/runtime/workflow", () => {
  beforeEach(() => {
    injectMocks(globalThis);
  });

  afterEach(() => {
    cleanupMocks(globalThis);
  });

  test("triggerWorkflow forwards args and returns Promise<string>", async () => {
    using wf = workflowMock();
    wf.setTriggerHandler("exec-42");

    const promise = workflow.triggerWorkflow("my-workflow", { a: 1 });

    expectTypeOf(promise).toEqualTypeOf<Promise<string>>();
    await expect(promise).resolves.toBe("exec-42");
    expect(wf.calls).toEqual([
      { method: "triggerWorkflow", args: ["my-workflow", { a: 1 }, undefined] },
    ]);
  });

  test("triggerWorkflow forwards options", async () => {
    using wf = workflowMock();
    await workflow.triggerWorkflow(
      "my-workflow",
      { a: 1 },
      {
        authInvoker: { namespace: "ns", machineUserName: "mu" },
      },
    );

    expect(wf.calls[0]?.args[2]).toEqual({
      authInvoker: { namespace: "ns", machineUserName: "mu" },
    });
  });

  test("triggerJobFunction forwards and returns enqueued result", () => {
    using wf = workflowMock();
    wf.enqueueResult({ ok: true });

    const result = workflow.triggerJobFunction("my-job", { id: 1 });

    expect(result).toEqual({ ok: true });
    expect(wf.triggeredJobs).toEqual([{ jobName: "my-job", args: { id: 1 } }]);
  });

  test("wait records the call and returns the configured result", () => {
    using wf = workflowMock();
    wf.setWaitHandler({ resumed: true });

    const result = workflow.wait("key-1", { p: 1 });

    expect(result).toEqual({ resumed: true });
    expect(wf.calls).toEqual([{ method: "wait", args: ["key-1", { p: 1 }] }]);
  });

  test("resolve records the call without invoking the callback", async () => {
    using wf = workflowMock();
    let invoked = false;
    await workflow.resolve("exec-1", "key-1", () => {
      invoked = true;
    });

    expect(invoked).toBe(false);
    expect(wf.calls).toHaveLength(1);
    expect(wf.calls[0]?.method).toBe("resolve");
  });
});
