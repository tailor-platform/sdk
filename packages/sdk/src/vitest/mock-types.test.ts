/**
 * Type-level tests verifying that the platform globals expose the concrete
 * signatures declared by `@tailor-platform/sdk/runtime/globals`.
 *
 * These are pure type assertions: the call expressions are wrapped in arrow
 * functions that are never invoked, so nothing touches `globalThis` at runtime
 * and no mock needs to be acquired. `expectTypeOf(fn).returns` inspects the
 * function's declared return type.
 */
import "@/runtime/globals";
import { describe, expectTypeOf, test } from "vitest";

describe("mock types match @tailor-platform/sdk/runtime/globals", () => {
  describe("tailor.secretmanager", () => {
    test("getSecrets returns Promise<Partial<Record<T[number], string>>>", () => {
      expectTypeOf(() =>
        tailor.secretmanager.getSecrets("vault", ["a", "b"] as const),
      ).returns.toEqualTypeOf<Promise<Partial<Record<"a" | "b", string>>>>();
    });

    test("getSecret returns Promise<string | undefined>", () => {
      expectTypeOf(() => tailor.secretmanager.getSecret("vault", "name")).returns.toEqualTypeOf<
        Promise<string | undefined>
      >();
    });
  });

  describe("tailor.workflow", () => {
    test("triggerWorkflow returns Promise<string>", () => {
      expectTypeOf(() => tailor.workflow.triggerWorkflow("wf", {})).returns.toEqualTypeOf<
        Promise<string>
      >();
    });
  });

  describe("tailor.context", () => {
    test("getInvoker returns Invoker | null", () => {
      expectTypeOf(() =>
        tailor.context.getInvoker(),
      ).returns.toEqualTypeOf<tailor.context.Invoker | null>();
    });
  });
});
