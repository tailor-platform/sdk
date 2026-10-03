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

  test("reports no truncation when the limit covers every item", async () => {
    const fetch = vi.fn().mockResolvedValue(["a", "b"]);

    await expect(fetchWithinLimit(2, fetch)).resolves.toEqual({
      items: ["a", "b"],
      truncated: false,
    });
  });
});

describe("reportTruncation", () => {
  test("tells the caller that more results exist beyond the limit", () => {
    using info = vi.spyOn(logger, "info").mockImplementation(() => {});

    reportTruncation({ items: ["a"], truncated: true }, 1);

    expect(info).toHaveBeenCalledWith(
      "More results exist beyond --limit 1. Raise --limit to see more.",
    );
  });

  test("stays silent when nothing was cut", () => {
    using info = vi.spyOn(logger, "info").mockImplementation(() => {});

    reportTruncation({ items: ["a"], truncated: false }, 1);

    expect(info).not.toHaveBeenCalled();
  });
});
