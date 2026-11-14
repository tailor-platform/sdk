import { describe, expect, test } from "vitest";
import { runWithConcurrency } from "./utils";

describe("runWithConcurrency", () => {
  test("rejects when a worker throws undefined", async () => {
    await expect(
      runWithConcurrency<unknown>([undefined], 1, async (item) => {
        throw item;
      }),
    ).rejects.toThrow("undefined");
  });
});
