/**
 * Type-level tests confirming that opting into `@tailor-platform/sdk/runtime/globals`
 * activates the ambient `tailor.*` / `tailordb` declarations.
 *
 * These assertions are type-only — they reference `tailor`, `tailordb`, and
 * `TailorDBFileError` solely through `typeof` so the test does not require
 * the platform runtime to inject those values into the unit test environment.
 */
import "@/runtime/globals";
import { describe, expectTypeOf, test } from "vitest";
import type { TailordbCommandType } from "@/runtime";

// @ts-expect-error Tailordb was removed in v2; use lowercase tailordb.*.
const legacyTailordbQueryResult = null as unknown as Tailordb.QueryResult<{ id: string }>;
void legacyTailordbQueryResult;

describe("@tailor-platform/sdk/runtime/globals activates ambient globals", () => {
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

  test("tailordb namespace exposes query helper types", () => {
    expectTypeOf<tailordb.QueryResult<{ id: string }>>().not.toBeAny();
    expectTypeOf<tailordb.CommandType>().toEqualTypeOf<TailordbCommandType>();
    expectTypeOf<tailordb.Client>().not.toBeAny();
  });

  test("TailorDBFileError is declared as a global class", () => {
    expectTypeOf<typeof TailorDBFileError>().not.toBeAny();
  });
});
