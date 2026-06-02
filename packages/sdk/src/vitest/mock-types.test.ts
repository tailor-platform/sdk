/**
 * Type-level tests verifying that the mock-injected globals expose the
 * concrete signatures declared by `@tailor-platform/sdk/runtime/globals`.
 *
 * Each test asserts a concrete return type (or call shape) — bare
 * `expectTypeOf(x).toEqualTypeOf<typeof x>()` self-comparisons are tautological
 * and are intentionally omitted because they would always pass.
 */
import "@/runtime/globals";
import { afterAll, beforeAll, describe, expectTypeOf, test } from "vitest";
import { cleanupMocks, injectMocks, secretmanagerMock, workflowMock } from "./mock";

beforeAll(() => injectMocks(globalThis));
afterAll(() => cleanupMocks(globalThis));

describe("mock types match @tailor-platform/sdk/runtime/globals", () => {
  describe("tailor.secretmanager", () => {
    test("getSecrets returns Promise<Partial<Record<T[number], string>>>", () => {
      using _sm = secretmanagerMock();
      expectTypeOf(tailor.secretmanager.getSecrets("vault", ["a", "b"] as const)).toEqualTypeOf<
        Promise<Partial<Record<"a" | "b", string>>>
      >();
    });

    test("getSecret returns Promise<string | undefined>", () => {
      using _sm = secretmanagerMock();
      expectTypeOf(tailor.secretmanager.getSecret("vault", "name")).toEqualTypeOf<
        Promise<string | undefined>
      >();
    });
  });

  describe("tailor.workflow", () => {
    test("triggerWorkflow returns Promise<string>", () => {
      using _wf = workflowMock();
      expectTypeOf(tailor.workflow.triggerWorkflow("wf", {})).toEqualTypeOf<Promise<string>>();
    });
  });

  describe("tailor.context", () => {
    test("getInvoker returns Invoker | null", () => {
      expectTypeOf(tailor.context.getInvoker()).toEqualTypeOf<tailor.context.Invoker | null>();
    });
  });
});
