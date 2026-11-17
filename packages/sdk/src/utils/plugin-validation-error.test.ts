import { describe, expect, test } from "vitest";
import { isPluginValidationError, PluginValidationError } from "./plugin-validation-error";

describe("isPluginValidationError", () => {
  test("recognizes a locally constructed validation error", () => {
    expect(
      isPluginValidationError(new PluginValidationError({ code: "INVALID", message: "Invalid" })),
    ).toBe(true);
  });

  test.each([
    null,
    undefined,
    "error",
    new Error("error"),
    { code: "INVALID" },
    { [Symbol.for("tailor-platform/sdk:plugin-validation-error")]: false },
  ])("rejects unrelated values: %j", (value) => {
    expect(isPluginValidationError(value)).toBe(false);
  });
});
