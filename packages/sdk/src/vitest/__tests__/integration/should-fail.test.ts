import { expect, test } from "vitest";

test("importing production code that uses node:crypto should throw", async () => {
  await expect(() => import("./fixtures/uses-node-crypto")).rejects.toThrow(
    "not available in the Tailor Platform runtime",
  );
});

test("Buffer is not available as a global", () => {
  expect(typeof Buffer).toBe("undefined");
});

test("setImmediate is not available as a global", () => {
  expect(typeof setImmediate).toBe("undefined");
});

test("performance is not available as a global", () => {
  expect(typeof performance).toBe("undefined");
});
