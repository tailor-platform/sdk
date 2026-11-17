import { describe, expect, test } from "vitest";
import { CLIError } from "./errors";
import { withTimeout } from "./progress";

const boom = () => CLIError({ code: "TEST_TIMEOUT", message: "boom" });

function pendingTimeoutCount(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
}

describe("withTimeout", () => {
  test("resolves with the promise result when it settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 60_000, boom)).resolves.toBe("ok");
  });

  test("rejects with the error the factory builds when the promise is too slow", async () => {
    const timeout = CLIError({ code: "TEST_TIMEOUT", message: "boom" });

    await expect(withTimeout(new Promise<never>(() => {}), 5, () => timeout)).rejects.toBe(timeout);
  });

  test("cancels the timer once the promise wins the race", async () => {
    const before = pendingTimeoutCount();

    await withTimeout(Promise.resolve("ok"), 60_000, boom);

    expect(pendingTimeoutCount()).toBe(before);
  });

  test("cancels the timer when the promise rejects before the timeout", async () => {
    const before = pendingTimeoutCount();

    await expect(withTimeout(Promise.reject(new Error("inner")), 60_000, boom)).rejects.toThrow(
      "inner",
    );

    expect(pendingTimeoutCount()).toBe(before);
  });
});
