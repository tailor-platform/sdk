import { describe, expect, test } from "vitest";
import { withTimeout } from "./progress";

function pendingTimeoutCount(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
}

describe("withTimeout", () => {
  test("resolves with the promise result when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 60_000, "boom")).resolves.toBe("ok");
  });

  test("rejects with the timeout message when the promise is too slow", async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 5, "boom")).rejects.toThrow("boom");
  });

  test("cancels the timer once the promise wins the race", async () => {
    const before = pendingTimeoutCount();

    await withTimeout(Promise.resolve("ok"), 60_000, "boom");

    expect(pendingTimeoutCount()).toBe(before);
  });

  test("cancels the timer when the promise rejects before the timeout", async () => {
    const before = pendingTimeoutCount();

    await expect(withTimeout(Promise.reject(new Error("inner")), 60_000, "boom")).rejects.toThrow(
      "inner",
    );

    expect(pendingTimeoutCount()).toBe(before);
  });
});
