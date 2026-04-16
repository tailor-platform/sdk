import { afterEach, describe, it, expect, expectTypeOf } from "vitest";
import { setupWaitPointMock } from "@/utils/test/mock";
import { defineWaitPoint, defineWaitPoints } from "./wait-point";

const TailorGlobal = globalThis as { tailor?: { workflow?: Record<string, unknown> } };

describe("defineWaitPoints", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  it("creates instances with typed wait/resolve", () => {
    const wps = defineWaitPoints((define) => ({
      approval: define<{ message: string }, { approved: boolean }>(),
    }));
    expectTypeOf(wps.approval.wait).toBeFunction();
    expectTypeOf(wps.approval.resolve).toBeFunction();
  });

  it("wait return type uses JsonifyOutput (Date→string)", () => {
    const wps = defineWaitPoints((define) => ({
      check: define<undefined, { timestamp: Date }>(),
    }));
    type WaitReturn = Awaited<ReturnType<typeof wps.check.wait>>;
    expectTypeOf<WaitReturn>().toEqualTypeOf<{ timestamp: string }>();
  });

  it("wait omits payload when Payload is undefined", () => {
    const wps = defineWaitPoints((define) => ({
      signal: define<undefined, { done: boolean }>(),
    }));
    type Params = Parameters<typeof wps.signal.wait>;
    expectTypeOf<Params>().toEqualTypeOf<[]>();
  });

  it("throws without platform API or mock", () => {
    const wps = defineWaitPoints((define) => ({
      approval: define<undefined, undefined>(),
    }));
    expect(() => wps.approval.wait()).toThrow("setupWaitPointMock()");
  });

  it("wait() delegates to mock", async () => {
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

  it("resolve() delegates to mock", async () => {
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

  it("sets correct key from property name", async () => {
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

  it("creates a typed instance with the given key", () => {
    const wp = defineWaitPoint<{ msg: string }, { ok: boolean }>("my-key");
    expectTypeOf(wp.wait).toBeFunction();
    expectTypeOf(wp.resolve).toBeFunction();
  });

  it("throws without platform API or mock", () => {
    const wp = defineWaitPoint<undefined, undefined>("my-step");
    expect(() => wp.wait()).toThrow("setupWaitPointMock()");
  });

  it("uses the provided key", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: (_key, _payload) => ({ ok: true }),
    });

    const wp = defineWaitPoint<{ msg: string }, { ok: boolean }>("approval");
    await wp.wait({ msg: "please" });
    expect(waitCalls[0]).toEqual({ key: "approval", payload: { msg: "please" } });
  });

  it("resolve delegates to mock", async () => {
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
