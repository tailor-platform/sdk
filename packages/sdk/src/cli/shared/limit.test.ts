import { describe, expect, test, vi } from "vitest";
import { fetchWithinLimit, reportTruncation } from "./limit";
import { logger } from "./logger";

describe("fetchWithinLimit", () => {
  test.each([undefined, 0])("fetches everything with limit %s", async (limit) => {
    const fetch = vi.fn().mockResolvedValue(["a", "b", "c"]);

    await expect(fetchWithinLimit(limit, fetch)).resolves.toEqual({
      items: ["a", "b", "c"],
      truncated: false,
    });
    expect(fetch).toHaveBeenCalledWith(limit);
  });

  test("asks for one more item and drops it when more exist", async () => {
    const fetch = vi.fn().mockResolvedValue(["a", "b", "c"]);

    await expect(fetchWithinLimit(2, fetch)).resolves.toEqual({
      items: ["a", "b"],
      truncated: true,
    });
    expect(fetch).toHaveBeenCalledWith(3);
  });

  test("keeps the probe within safe integers for the largest accepted limit", async () => {
    const fetch = vi.fn().mockResolvedValue(["a"]);

    await expect(fetchWithinLimit(Number.MAX_SAFE_INTEGER, fetch)).resolves.toEqual({
      items: ["a"],
      truncated: false,
    });
    expect(fetch).toHaveBeenCalledWith(Number.MAX_SAFE_INTEGER);
  });

  test("reports no truncation when the limit covers every item", async () => {
    const fetch = vi.fn().mockResolvedValue(["a", "b"]);

    await expect(fetchWithinLimit(2, fetch)).resolves.toEqual({
      items: ["a", "b"],
      truncated: false,
    });
  });
});

describe("reportTruncation", () => {
  test("tells the caller that more results exist beyond the limit", async () => {
    using info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await reportTruncation({ items: ["a"], truncated: true }, 1);

    expect(info).toHaveBeenCalledWith(
      "More results exist beyond --limit 1. Raise --limit to see more.",
    );
  });

  test("stays silent when nothing was cut", async () => {
    using info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await reportTruncation({ items: ["a"], truncated: false }, 1);

    expect(info).not.toHaveBeenCalled();
  });

  test("waits for buffered list output to flush before the notice", async () => {
    using info = vi.spyOn(logger, "info").mockImplementation(() => {});
    using _buffered = vi.spyOn(process.stdout, "writableLength", "get").mockReturnValue(1);
    let flushed: (() => void) | undefined;
    using _write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((_chunk: unknown, callback?: unknown) => {
        if (typeof callback === "function") flushed = callback as () => void;
        return false;
      });

    const reported = reportTruncation({ items: ["a"], truncated: true }, 1);
    await Promise.resolve();

    expect(info).not.toHaveBeenCalled();
    flushed?.();
    await reported;
    expect(info).toHaveBeenCalledOnce();
  });
});
