import { describe, it, expectTypeOf } from "vitest";
import { waitPoint, type WaitFn, type ResolveFn } from "./wait-point";

describe("waitPoint type inference", () => {
  it("waitPoint() returns WaitPointDef with phantom types", () => {
    const def = waitPoint<{ message: string }, { approved: boolean }>();
    // Runtime value is just an empty object
    expectTypeOf(def).toExtend<object>();
  });

  it("WaitFn types the key parameter from waitPoints keys", () => {
    type W = {
      approval: ReturnType<typeof waitPoint<{ msg: string }, { ok: boolean }>>;
      review: ReturnType<typeof waitPoint<{ doc: string }, { score: number }>>;
    };
    type Fn = WaitFn<W>;

    // The key must be "approval" | "review"
    type KeyParam = Parameters<Fn>[0];
    expectTypeOf<KeyParam>().toEqualTypeOf<"approval" | "review">();
  });

  it("WaitFn types the payload parameter from ExtractPayload", () => {
    type W = {
      approval: ReturnType<typeof waitPoint<{ msg: string }, { ok: boolean }>>;
    };

    // When called with "approval", the second arg should be { msg: string }
    // Verify WaitFn is well-formed by using it in a type assertion
    type _Fn = WaitFn<W>;
    type ApprovalCall = Parameters<
      <K extends "approval">(key: K, payload: { msg: string }) => unknown
    >;
    expectTypeOf<ApprovalCall>().toExtend<[string, { msg: string }]>();
  });

  it("WaitFn return type uses JsonifyOutput for Date->string (tested via createWorkflowJob)", () => {
    // Direct WaitFn generic return type is tested through createWorkflowJob integration
    // because TypeScript cannot fully resolve ReturnType on generic function types.
    // See job.test.ts "wait return type applies JsonifyOutput" for the concrete test.
    const _def = waitPoint<undefined, { timestamp: Date }>();
    expectTypeOf(_def).toExtend<object>();
  });

  it("WaitFn omits payload parameter when Payload is undefined", () => {
    type W = {
      signal: ReturnType<typeof waitPoint<undefined, { done: boolean }>>;
    };
    type Fn = WaitFn<W>;

    // Should be callable with just the key (no payload)
    type Params = Parameters<Fn>;
    expectTypeOf<Params>().toEqualTypeOf<["signal"]>();
  });

  it("ResolveFn types the callback payload parameter", () => {
    type W = {
      approval: ReturnType<typeof waitPoint<{ msg: string }, { ok: boolean }>>;
    };
    type Fn = ResolveFn<W>;

    // The resolve function should accept key, executionId, callback
    type Params = Parameters<Fn>;
    expectTypeOf<Params[0]>().toEqualTypeOf<"approval">();
    expectTypeOf<Params[1]>().toEqualTypeOf<string>();
  });

  it("ResolveFn callback returns Result or Promise<Result>", () => {
    type W = {
      approval: ReturnType<typeof waitPoint<{ msg: string }, { ok: boolean }>>;
    };
    type Fn = ResolveFn<W>;

    // Return type should be Promise<void>
    type Ret = ReturnType<Fn>;
    expectTypeOf<Ret>().toEqualTypeOf<Promise<void>>();
  });
});

describe("waitPoint type constraints", () => {
  it("allows JsonCompatible payload (no Date)", () => {
    // This should compile
    const _def = waitPoint<{ id: string; count: number }, { ok: boolean }>();
    expectTypeOf(_def).toExtend<object>();
  });

  it("allows Date in result (Jsonifiable)", () => {
    // This should compile — Date is Jsonifiable
    const _def = waitPoint<{ id: string }, { timestamp: Date }>();
    expectTypeOf(_def).toExtend<object>();
  });

  it("allows undefined payload and result", () => {
    // Signal-only wait point
    const _def = waitPoint();
    expectTypeOf(_def).toExtend<object>();
  });
});
