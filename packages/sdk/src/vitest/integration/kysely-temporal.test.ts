import { expect, test } from "vitest";

test("the kysely type plugin's temporal option reaches the worker before the test file evaluates", () => {
  expect(process.env.__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL).toBe("true");
});
