import { afterEach, describe, it, expect, expectTypeOf } from "vitest";
import { setupWaitPointMock } from "@/utils/test/mock";
import { defineWaitPoints } from "./wait-point";

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

  it("wait/resolve coordination works", async () => {
    const wps = defineWaitPoints((define) => ({
      approval: define<{ msg: string }, { ok: boolean }>(),
    }));

    const resultPromise = wps.approval.wait({ msg: "test" });
    await wps.approval.resolve("exec-1", (payload) => {
      expect(payload).toEqual({ msg: "test" });
      return { ok: true };
    });
    expect(await resultPromise).toEqual({ ok: true });
  });

  it("error message includes the correct key", async () => {
    const wps = defineWaitPoints((define) => ({
      approval: define<undefined, undefined>(),
    }));
    await expect(wps.approval.resolve("exec-1", () => undefined)).rejects.toThrow(
      'No pending wait for key "approval"',
    );
  });

  it("wait() delegates to globalThis.tailor.workflow.wait when available", async () => {
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

  it("resolve() delegates to globalThis.tailor.workflow.resolve when available", async () => {
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

  it("setupWaitPointMock works for mocking platform API", async () => {
    const mock = setupWaitPointMock({
      onWait: () => "mocked-result",
    });

    const wps = defineWaitPoints((define) => ({
      step: define<undefined, string>(),
    }));

    const result = await wps.step.wait();
    expect(result).toBe("mocked-result");
    expect(mock.waitCalls).toHaveLength(1);
  });
});
