import { expect, test } from "vitest";

test("importing production code that uses node:crypto should throw", async () => {
  await expect(() => import("./fixtures/uses-node-crypto")).rejects.toThrow(
    "not available in the Tailor Platform runtime",
  );
});
