import { describe, expect, test } from "vitest";
import { serializeTriggerContext, type TriggerContext } from "./trigger-context";

describe("serializeTriggerContext", () => {
  function emptyContext(): TriggerContext {
    return {
      workflowNameMap: new Map(),
      jobNameMap: new Map(),
      workflowFileMap: new Map(),
    };
  }

  test("returns empty string for undefined", () => {
    expect(serializeTriggerContext(undefined)).toBe("");
  });

  test("returns deterministic output for empty maps", () => {
    const a = serializeTriggerContext(emptyContext());
    const b = serializeTriggerContext(emptyContext());

    expect(a).toBe(b);
    expect(a).toBe("[][][]");
  });

  test("returns same output regardless of map insertion order", () => {
    const ctx1 = emptyContext();
    ctx1.workflowNameMap.set("b", "WorkflowB");
    ctx1.workflowNameMap.set("a", "WorkflowA");

    const ctx2 = emptyContext();
    ctx2.workflowNameMap.set("a", "WorkflowA");
    ctx2.workflowNameMap.set("b", "WorkflowB");

    expect(serializeTriggerContext(ctx1)).toBe(serializeTriggerContext(ctx2));
  });

  test("returns different output when map content differs", () => {
    const ctx1 = emptyContext();
    ctx1.jobNameMap.set("job1", "ProcessOrder");

    const ctx2 = emptyContext();
    ctx2.jobNameMap.set("job1", "ProcessPayment");

    expect(serializeTriggerContext(ctx1)).not.toBe(serializeTriggerContext(ctx2));
  });

  test("distinguishes entries in different maps", () => {
    const ctx1 = emptyContext();
    ctx1.workflowNameMap.set("x", "Name");

    const ctx2 = emptyContext();
    ctx2.jobNameMap.set("x", "Name");

    expect(serializeTriggerContext(ctx1)).not.toBe(serializeTriggerContext(ctx2));
  });
});
