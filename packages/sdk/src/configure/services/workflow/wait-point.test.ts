// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { afterEach, describe, expect, test, expectTypeOf } from "vitest";
import { setupWaitPointMock, setupWorkflowMock } from "#/utils/test/mock";
import { getRegisteredWaitPoints, restoreWaitPointRegistry } from "#/utils/wait-point-registry";
import { createWaitPoint, createWaitPoints } from "./wait-point";
import type { TailorRuntime } from "#/runtime/index";
import type { TypeLevelError } from "#/types/helpers";

const TailorGlobal = globalThis as { tailor?: TailorRuntime };

describe("createWaitPoints", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("invalid definitions expose TypeLevelError messages", () => {
    expectTypeOf<ReturnType<typeof createWaitPoint<null, { ok: boolean }>>>().toEqualTypeOf<
      TypeLevelError<"Payload cannot be null at the top level">
    >();

    expectTypeOf<
      ReturnType<typeof createWaitPoint<{ id: string } | null, { ok: boolean }>>
    >().toEqualTypeOf<TypeLevelError<"Payload cannot be null at the top level">>();

    expectTypeOf<ReturnType<typeof createWaitPoint<undefined, undefined>>>().toEqualTypeOf<
      TypeLevelError<"Result cannot be (or include) undefined (resolve callback must return a value)">
    >();

    expectTypeOf<
      ReturnType<typeof createWaitPoint<undefined, { ok: boolean } | undefined>>
    >().toEqualTypeOf<
      TypeLevelError<"Result cannot be (or include) undefined (resolve callback must return a value)">
    >();

    expectTypeOf<
      ReturnType<typeof createWaitPoint<undefined, { timestamp: Date }>>
    >().toEqualTypeOf<
      TypeLevelError<"Result must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">
    >();

    expectTypeOf<
      ReturnType<typeof createWaitPoint<{ id: string } | undefined, { ok: boolean }>>
    >().toEqualTypeOf<TypeLevelError<"Payload cannot include undefined at the top level">>();

    expectTypeOf<
      ReturnType<typeof createWaitPoint<{ when: Date }, { ok: boolean }>>
    >().toEqualTypeOf<
      TypeLevelError<"Payload must be JsonValue-compatible (plain objects/arrays; no class instances or functions)">
    >();
  });

  test("creates instances with typed wait/resolve", () => {
    const wps = createWaitPoints((define) => ({
      approval: define<{ message: string }, { approved: boolean }>(),
    }));
    expectTypeOf(wps.approval.wait).toBeFunction();
    expectTypeOf(wps.approval.resolve).toBeFunction();
  });

  test("rejects Date in Payload / Result (pure JSON only)", () => {
    createWaitPoints((define) => ({
      // @ts-expect-error - Date is not JsonValue-compatible (Result)
      check: define<undefined, { timestamp: Date }>(),
    }));
    createWaitPoints((define) => ({
      // @ts-expect-error - Date is not JsonValue-compatible (Payload)
      check: define<{ when: Date }, { ok: boolean }>(),
    }));
  });

  test("rejects top-level null in Payload", () => {
    createWaitPoints((define) => ({
      // @ts-expect-error - null is not allowed at top level (even in union)
      check: define<{ id: string } | null, { ok: boolean }>(),
    }));
  });

  test("rejects top-level undefined in Payload union", () => {
    createWaitPoints((define) => ({
      // @ts-expect-error - undefined is not allowed at top level (except when Payload = undefined alone)
      check: define<{ id: string } | undefined, { ok: boolean }>(),
    }));
  });

  test("allows Payload = undefined (no-payload convention)", () => {
    const wps = createWaitPoints((define) => ({
      check: define<undefined, { ok: boolean }>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("allows nested null in Payload", () => {
    const wps = createWaitPoints((define) => ({
      check: define<{ data: string | null }, { ok: boolean }>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("allows top-level null in Result", () => {
    const wps = createWaitPoints((define) => ({
      check: define<{ id: string }, { data: string } | null>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("wait return type is Result as-is (no Jsonify transformation)", () => {
    const wps = createWaitPoints((define) => ({
      check: define<undefined, { count: number; tags: string[] }>(),
    }));
    type WaitReturn = Awaited<ReturnType<typeof wps.check.wait>>;
    expectTypeOf<WaitReturn>().toEqualTypeOf<{ count: number; tags: string[] }>();
  });

  test("wait omits payload when Payload is undefined", () => {
    const wps = createWaitPoints((define) => ({
      signal: define<undefined, { done: boolean }>(),
    }));
    type Params = Parameters<typeof wps.signal.wait>;
    expectTypeOf<Params>().toEqualTypeOf<[]>();
  });

  test("throws without platform API or mock", () => {
    const wps = createWaitPoints((define) => ({
      approval: define<undefined, { ok: boolean }>(),
    }));
    expect(() => wps.approval.wait()).toThrow("mockWorkflow");
  });

  test("throws a helpful error when only setupWorkflowMock is active (wait/resolve auto-stubbed)", () => {
    setupWorkflowMock(() => undefined);
    const wps = createWaitPoints((define) => ({
      approval: define<undefined, { ok: boolean }>(),
    }));
    expect(() => wps.approval.wait()).toThrow("mockWorkflow");
  });

  test("rejects Result = undefined (callback must return a value)", () => {
    createWaitPoints((define) => ({
      // @ts-expect-error - Result cannot be undefined; platform throws if callback returns undefined
      check: define<undefined, undefined>(),
    }));
  });

  test("rejects top-level undefined in Result union", () => {
    createWaitPoints((define) => ({
      // @ts-expect-error - Result cannot include top-level undefined
      check: define<undefined, { ok: boolean } | undefined>(),
    }));
  });

  test("allows nested undefined (optional fields) in Result", () => {
    const wps = createWaitPoints((define) => ({
      check: define<undefined, { ok: boolean; reason?: string }>(),
    }));
    expectTypeOf(wps.check.wait).toBeFunction();
  });

  test("wait() delegates to mock", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: (_key, _payload) => ({ approved: true }),
    });

    const wps = createWaitPoints((define) => ({
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

    const wps = createWaitPoints((define) => ({
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

    const wps = createWaitPoints((define) => ({
      step: define<undefined, string>(),
    }));

    await wps.step.wait();
    expect(waitCalls[0]).toEqual({ key: "step", payload: undefined });
  });
});

describe("createWaitPoint", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("creates a typed instance with the given key", () => {
    const wp = createWaitPoint<{ msg: string }, { ok: boolean }>("my-key");
    expectTypeOf(wp.wait).toBeFunction();
    expectTypeOf(wp.resolve).toBeFunction();
  });

  test("throws without platform API or mock", () => {
    const wp = createWaitPoint<undefined, { ok: boolean }>("my-step");
    expect(() => wp.wait()).toThrow("mockWorkflow");
  });

  test("rejects Result = undefined (callback must return a value)", () => {
    const wp = createWaitPoint<undefined, undefined>("my-step");
    // @ts-expect-error - wp resolves to an error string, not WaitPointInstance
    expectTypeOf(wp.wait).toBeFunction();
  });

  test("uses the provided key", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: (_key, _payload) => ({ ok: true }),
    });

    const wp = createWaitPoint<{ msg: string }, { ok: boolean }>("approval");
    await wp.wait({ msg: "please" });
    expect(waitCalls[0]).toEqual({ key: "approval", payload: { msg: "please" } });
  });

  test("resolve delegates to mock", async () => {
    const { resolveCalls } = setupWaitPointMock({
      onResolve: async (_execId, _key, callback) => {
        callback(undefined);
      },
    });

    const wp = createWaitPoint<undefined, { ok: boolean }>("my-step");
    await wp.resolve("exec-1", () => ({ ok: true }));
    expect(resolveCalls[0]).toEqual({ executionId: "exec-1", key: "my-step" });
  });

  test("accepts a run of hyphens, which the key grammar allows", async () => {
    const { waitCalls } = setupWaitPointMock({ onWait: () => "ok" });

    const wp = createWaitPoint<undefined, string>("my--step");
    await wp.wait();
    expect(waitCalls[0]).toEqual({ key: "my--step", payload: undefined });
  });

  test("reads a bare $ as a literal, the way the type does", async () => {
    const { waitCalls } = setupWaitPointMock({ onWait: () => "ok" });

    // `$` on its own names no param. The type says so, so the value has to
    // agree: `.wait()` rather than a `.with()` the type never showed.
    // `deploy` is what rejects the key.
    const wp = createWaitPoint<undefined, string>("my-$");
    await wp.wait();
    expect(waitCalls[0]).toEqual({ key: "my-$", payload: undefined });
  });
});

describe("$param keys", () => {
  afterEach(() => {
    delete TailorGlobal.tailor;
  });

  test("derives the params object from the key", () => {
    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("line-approval-$lineId")<
        { message: string },
        { approved: boolean }
      >(),
    }));
    type Params = Parameters<typeof wps.lineApproval.with>[0];
    expectTypeOf<Params>().toEqualTypeOf<{ lineId: string }>();
  });

  test("derives every param in a multi-param key", () => {
    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("order-$orderId-line-$lineNo")<undefined, { approved: boolean }>(),
    }));
    type Params = Parameters<typeof wps.lineApproval.with>[0];
    expectTypeOf<Params>().toEqualTypeOf<{ orderId: string; lineNo: string }>();
  });

  test("a key without $params keeps the unparameterized surface", () => {
    const wps = createWaitPoints((define) => ({
      approval: define.for("my-approval")<undefined, { approved: boolean }>(),
    }));
    expectTypeOf(wps.approval.wait).toBeFunction();
    expectTypeOf(wps.approval).not.toHaveProperty("with");
  });

  test("rejects a key that is not a literal", () => {
    const key: string = "line-approval";
    createWaitPoints((define) => ({
      // @ts-expect-error a widened string cannot be checked for $params
      bad: define.for(key)<undefined, string>(),
    }));
  });

  test("with() substitutes params into the key", async () => {
    const { waitCalls } = setupWaitPointMock({
      onWait: () => ({ approved: true }),
    });

    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("line-approval-$lineId")<
        { message: string },
        { approved: boolean }
      >(),
    }));

    const result = await wps.lineApproval
      .with({ lineId: "0191f3a2-7c4e" })
      .wait({ message: "please" });

    expect(result).toEqual({ approved: true });
    expect(waitCalls).toEqual([
      { key: "line-approval-0191f3a2-7c4e", payload: { message: "please" } },
    ]);
  });

  test("with() keeps concurrent bindings apart", async () => {
    const { waitCalls } = setupWaitPointMock({ onWait: () => ({ approved: true }) });

    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("line-approval-$lineId")<undefined, { approved: boolean }>(),
    }));

    await Promise.all([
      wps.lineApproval.with({ lineId: "a1" }).wait(),
      wps.lineApproval.with({ lineId: "a2" }).wait(),
    ]);

    expect(waitCalls.map((c) => c.key)).toEqual(["line-approval-a1", "line-approval-a2"]);
  });

  test("with() substitutes params for resolve too", async () => {
    const { resolveCalls } = setupWaitPointMock({
      onResolve: async (_execId, _key, callback) => {
        callback(undefined);
      },
    });

    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("line-approval-$lineId")<undefined, { approved: boolean }>(),
    }));

    await wps.lineApproval.with({ lineId: "a1" }).resolve("exec-1", () => ({ approved: true }));

    expect(resolveCalls).toEqual([{ executionId: "exec-1", key: "line-approval-a1" }]);
  });

  test("rejects param values that would break the key grammar", () => {
    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("line-approval-$lineId")<undefined, { approved: boolean }>(),
    }));

    expect(() => wps.lineApproval.with({ lineId: "" })).toThrow('for parameter "lineId"');
    expect(() => wps.lineApproval.with({ lineId: "Line1" })).toThrow('for parameter "lineId"');
    expect(() => wps.lineApproval.with({ lineId: "line_1" })).toThrow('for parameter "lineId"');
    expect(() => wps.lineApproval.with({ lineId: "-a" })).toThrow('for parameter "lineId"');
    expect(() => wps.lineApproval.with({ lineId: "a-" })).toThrow('for parameter "lineId"');
    // @ts-expect-error param values must be strings
    expect(() => wps.lineApproval.with({ lineId: 1 })).toThrow("needs a string");
    // @ts-expect-error every param must be supplied
    expect(() => wps.lineApproval.with({})).toThrow("needs a string");
  });

  test("rejects a composed key longer than the platform limit", () => {
    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("line-approval-$lineId")<undefined, { approved: boolean }>(),
    }));

    expect(() => wps.lineApproval.with({ lineId: "a".repeat(50) })).toThrow("the limit is 63");
  });

  test("accepts a run of hyphens alongside $params", async () => {
    const { waitCalls } = setupWaitPointMock({ onWait: () => ({ approved: true }) });

    const wps = createWaitPoints((define) => ({
      lineApproval: define.for("line--approval-$lineId")<undefined, { approved: boolean }>(),
    }));

    await wps.lineApproval.with({ lineId: "a1" }).wait();
    expect(waitCalls[0]?.key).toBe("line--approval-a1");
  });

  test("leaves a bare `$` to the grammar rather than binding it as a param", () => {
    // A key `deploy` rejects, and the registry is process-wide, so put it back
    // before another test file runs the deploy-time check.
    const mark = getRegisteredWaitPoints().length;
    try {
      const wps = createWaitPoints((define) => ({
        odd: define.for("line-$lineId-$")<undefined, string>(),
      }));

      // Reading the bare `$` as a param would ask for one named "", and report
      // the key as needing a value for a parameter the reader cannot name.
      expect(() => wps.odd.with({ lineId: "a1" }).wait()).toThrow(
        'Wait point key "line-a1-$" built from "line-$lineId-$" must match',
      );
    } finally {
      restoreWaitPointRegistry(mark);
    }
  });

  test("points a $param key at the declaration that can type it", () => {
    // A $param key on createWaitPoint is one `deploy` rejects, and the registry
    // is process-wide, so put it back before another test file runs the
    // deploy-time check over everything declared so far.
    const mark = getRegisteredWaitPoints().length;
    try {
      // `.with()` is invisible to a createWaitPoint caller, so telling them to
      // bind through it would be advice they cannot follow.
      const fromCreateWaitPoint = createWaitPoint<undefined, string>("unbound-probe-$id");
      expect(() => fromCreateWaitPoint.wait()).toThrow(
        "Declare it through createWaitPoints instead",
      );

      const wps = createWaitPoints((define) => ({
        bound: define.for("unbound-define-$id")<undefined, string>(),
      }));
      expect(() => (wps.bound as unknown as { wait: () => void }).wait()).toThrow(
        "Bind them first",
      );
    } finally {
      restoreWaitPointRegistry(mark);
    }

    // Nothing declared above is left behind for the deploy-time check that
    // another test file runs over the whole registry.
    expect(getRegisteredWaitPoints()).toHaveLength(mark);
  });

  test("registers every declared key with the declaration it came from", () => {
    const before = getRegisteredWaitPoints().length;

    createWaitPoint<undefined, string>("registered-plain");
    createWaitPoints((define) => ({
      // Every key here has to be one `deploy` accepts: the registry is
      // process-wide, so a bad key declared in a unit test would reach the
      // deploy-time check another test file runs.
      "registered-property": define<undefined, string>(),
      fromKey: define.for("registered-$lineId")<undefined, string>(),
    }));

    // The keys the platform rules run against at deploy time.
    expect(getRegisteredWaitPoints().slice(before)).toEqual([
      { key: "registered-plain", declaredBy: "createWaitPoint" },
      { key: "registered-$lineId", declaredBy: "define" },
      { key: "registered-property", declaredBy: "property" },
    ]);
  });
});
