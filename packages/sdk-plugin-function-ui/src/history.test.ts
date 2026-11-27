import { describe, expect, test } from "vitest";
import { HISTORY_LIMIT, prependEntry } from "./history";

describe("prependEntry", () => {
  test("puts the newest entry first", () => {
    expect(prependEntry(["b", "a"], "c", 5)).toEqual(["c", "b", "a"]);
  });

  test("drops the oldest entries past the limit", () => {
    expect(prependEntry(["c", "b", "a"], "d", 3)).toEqual(["d", "c", "b"]);
  });

  test("keeps no more than the limit however many entries arrive", () => {
    const entries = Array.from({ length: HISTORY_LIMIT * 3 }, (_, i) => i).reduce<number[]>(
      (current, next) => prependEntry(current, next, HISTORY_LIMIT),
      [],
    );

    expect([entries.length, entries[0], entries.at(-1)]).toEqual([
      HISTORY_LIMIT,
      HISTORY_LIMIT * 3 - 1,
      HISTORY_LIMIT * 2,
    ]);
  });
});
