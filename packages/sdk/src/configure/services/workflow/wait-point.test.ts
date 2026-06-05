// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { afterEach, describe, expect, test, expectTypeOf } from "vitest";
import { setupWaitPointMock, setupWorkflowMock } from "@/utils/test/mock";
import { defineWaitPoint, defineWaitPoints } from "./wait-point";
import type { TailorRuntime } from "@/runtime";

const TailorGlobal = globalThis as { tailor?: TailorRuntime };

describe("defineWaitPoints", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("creates instances with typed wait/resolve", () => {
    const wps = defineWaitPoints((define) => ({
      approval: define<{ message: string }, { approved: boolean }>(),
    }));
    expectTypeOf(wps.approval.wait).toBeFunction();
    expectTypeOf(wps.approval.resolve).toBeFunction();
  });

  test("rejects Date in Payload / Result (pure JSON only)", () => {
    defineWaitPoints((define) => ({
      // @ts-expect-error - Date is not JsonValue-compatible (Result)
      check: define<undefined, { timestamp: Date }>(),
    }));
    defineWaitPoints((define) => ({
      // @ts-expect-error - Date is not JsonValue-compatible (Payload)
      check: define<{ when: Date }, { ok: boolean }>(),
    }));
  });

  test("rejects top-level null in Payload", () => {
    defineWaitPoints((define) => ({
      // @ts-expect-error - null is not allowed at top level (even in union)
      check: define<{ id: string } | null, { ok: boolean }>(),
    }));
  });

  test("rejects top-level undefined in Payload union", () => {
    defineWaitPoints((define) => ({
      // @ts-expect-error - undefined is not allowed at top level (except when Payload = undefined alone)
      check: define<{ id: string } | undefined, { ok: boolean }>(),
    }));
  });

  test("allows Payload = undefined (no-payload convention)", () => {
    const wps = defineWaitPoints((define) => ({
      check: define<undefined, { ok: boolean }>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("allows nested null in Payload", () => {
    const wps = defineWaitPoints((define) => ({
      check: define<{ data: string | null }, { ok: boolean }>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("allows top-level null in Result", () => {
    const wps = defineWaitPoints((define) => ({
      check: define<{ id: string }, { data: string } | null>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("wait return type is Result as-is (no Jsonify transformation)", () => {
    const wps = defineWaitPoints((define) => ({
      check: define<undefined, { count: number; tags: string[] }>(),
    }));
    type WaitReturn = Awaited<ReturnType<typeof wps.check.wait>>;
    expectTypeOf<WaitReturn>().toEqualTypeOf<{ count: number; tags: string[] }>();
  });

  test("wait omits payload when Payload is undefined", () => {
    const wps = defineWaitPoints((define) => ({
      signal: define<undefined, { done: boolean }>(),
    }));
    type Params = Parameters<typeof wps.signal.wait>;
    expectTypeOf<Params>().toEqualTypeOf<[]>();
  });

  test("throws without platform API or mock", () => {
    const wps = defineWaitPoints((define) => ({
      approval: define<undefined, { ok: boolean }>(),
    }));
    expect(() => wps.approval.wait()).toThrow("workflowMock");
  });

  test("throws a helpful error when only setupWorkflowMock is active (wait/resolve auto-stubbed)", () => {
    setupWorkflowMock(() => undefined);
    const wps = defineWaitPoints((define) => ({
      approval: define<undefined, { ok: boolean }>(),
    }));
    expect(() => wps.approval.wait()).toThrow("workflowMock");
  });

  test("rejects Result = undefined (callback must return a value)", () => {
    defineWaitPoints((define) => ({
      // @ts-expect-error - Result cannot be undefined; platform throws if callback returns undefined
      check: define<undefined, undefined>(),
    }));
  });

  test("rejects top-level undefined in Result union", () => {
    defineWaitPoints((define) => ({
      // @ts-expect-error - Result cannot include top-level undefined
      check: define<undefined, { ok: boolean } | undefined>(),
    }));
  });

  test("allows nested undefined (optional fields) in Result", () => {
    const wps = defineWaitPoints((define) => ({
      check: define<undefined, { ok: boolean; reason?: string }>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("wait() delegates to mock", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: (_key, _payload) => ({ approved: true }),
    });

    const wps = defineWaitPoints((define) => ({
      approval: define<{ msg: string }, { approved: boolean }>(),
    }));

    const result = await wps.approval.wait({ msg: "please" });
    expect(result).toEqual({ approved: true });
    expect(waitCalls).toHaveLength(1);
    expect(waitCalls[0]).toEqual({ key: "approval", payload: { msg: "please" } });
  });

  test("resolve() delegates to mock", async () => {
    const { resolveCalls } = setupWaitPointMock({
      onResolve: async (_execId, _key, callback) => {
        callback({ msg: "hello" });
      },
    });

    const wps = defineWaitPoints((define) => ({
      approval: define<{ msg: string }, { ok: boolean }>(),
    }));

    await wps.approval.resolve("exec-1", (payload) => {
      expect(payload).toEqual({ msg: "hello" });
      return { ok: true };
    });
    expect(resolveCalls).toHaveLength(1);
    expect(resolveCalls[0]).toEqual({ executionId: "exec-1", key: "approval" });
  });

  test("sets correct key from property name", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: () => "ok",
    });

    const wps = defineWaitPoints((define) => ({
      step: define<undefined, string>(),
    }));

    await wps.step.wait();
    expect(waitCalls[0]).toEqual({ key: "step", payload: undefined });
  });
});

describe("defineWaitPoint", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("creates a typed instance with the given key", () => {
    const wp = defineWaitPoint<{ msg: string }, { ok: boolean }>("my-key");
    expectTypeOf(wp.wait).toBeFunction();
    expectTypeOf(wp.resolve).toBeFunction();
  });

  test("throws without platform API or mock", () => {
    const wp = defineWaitPoint<undefined, { ok: boolean }>("my-step");
    expect(() => wp.wait()).toThrow("workflowMock");
  });

  test("rejects Result = undefined (callback must return a value)", () => {
    const wp = defineWaitPoint<undefined, undefined>("my-step");
    // @ts-expect-error - wp resolves to an error string, not WaitPointInstance
    expectTypeOf(wp.wait).toBeFunction();
  });

  test("uses the provided key", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: (_key, _payload) => ({ ok: true }),
    });

    const wp = defineWaitPoint<{ msg: string }, { ok: boolean }>("approval");
    await wp.wait({ msg: "please" });
    expect(waitCalls[0]).toEqual({ key: "approval", payload: { msg: "please" } });
  });

  test("resolve delegates to mock", async () => {
    const { resolveCalls } = setupWaitPointMock({
      onResolve: async (_execId, _key, callback) => {
        callback(undefined);
      },
    });

    const wp = defineWaitPoint<undefined, { ok: boolean }>("my-step");
    await wp.resolve("exec-1", () => ({ ok: true }));
    expect(resolveCalls[0]).toEqual({ executionId: "exec-1", key: "my-step" });
  });
});
