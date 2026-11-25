import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { pollUntil } from "./poll-until";

describe("pollUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const run = (read: () => Promise<string | undefined>, deadline?: number) =>
    pollUntil<string>({
      pollInterval: 1000,
      deadline,
      read,
      onTimeout: (stage) => `timeout:${stage}`,
      onError: (error) => `error:${(error as Error).message}`,
    });

  test("reads again after the interval until a read settles", async () => {
    const read = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("done");

    const result = run(read);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe("done");
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("keeps reading after a transient failure", async () => {
    const read = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValueOnce(new ConnectError("busy", Code.Unavailable))
      .mockResolvedValueOnce("done");

    const result = run(read);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe("done");
  });

  test("ends with the error handler's result on a failure that cannot be retried", async () => {
    const result = run(async () => {
      throw new Error("boom");
    });

    await expect(result).resolves.toBe("error:boom");
  });

  test("ends as timed out at the deadline without reading once it has passed", async () => {
    const read = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);

    const result = run(read, Date.now() + 1500);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(result).resolves.toBe("timeout:deadline");
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("ends as timed out while reading when a read outlasts the deadline", async () => {
    const result = pollUntil<string>({
      pollInterval: 1000,
      deadline: Date.now() + 500,
      read: (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      onTimeout: (stage) => `timeout:${stage}`,
      onError: (error) => `error:${(error as Error).message}`,
    });
    await vi.advanceTimersByTimeAsync(600);

    await expect(result).resolves.toBe("timeout:read");
  });
});
