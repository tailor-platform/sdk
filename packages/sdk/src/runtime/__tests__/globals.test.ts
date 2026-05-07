/**
 * Type-level tests confirming that importing the runtime entries activates
 * the ambient `tailor.*` / `tailordb` globals declared in
 * `src/runtime/globals.ts`.
 *
 * These assertions are type-only — they reference `tailor`, `tailordb`, and
 * `TailorDBFileError` solely through `typeof` so the test does not require
 * the platform runtime to inject those values into the unit test environment.
 */
import "@/runtime";
import { describe, expectTypeOf, test } from "vitest";

describe("@tailor-platform/sdk/runtime activates ambient globals", () => {
  test("tailor.iconv.convert is declared as a function", () => {
    expectTypeOf<typeof tailor.iconv.convert>().toBeFunction();
  });

  test("tailor.secretmanager.getSecret returns Promise<string | undefined>", () => {
    expectTypeOf<ReturnType<typeof tailor.secretmanager.getSecret>>().toEqualTypeOf<
      Promise<string | undefined>
    >();
  });

  test("tailor.workflow.triggerWorkflow returns Promise<string>", () => {
    expectTypeOf<ReturnType<typeof tailor.workflow.triggerWorkflow>>().toEqualTypeOf<
      Promise<string>
    >();
  });

  test("tailor.context.Invoker is exposed as a namespace type", () => {
    expectTypeOf<tailor.context.Invoker | null>().not.toBeAny();
  });

  test("tailordb.file.upload is declared as a function", () => {
    expectTypeOf<typeof tailordb.file.upload>().toBeFunction();
  });

  test("TailorDBFileError is declared as a global class", () => {
    expectTypeOf<typeof TailorDBFileError>().not.toBeAny();
  });
});
