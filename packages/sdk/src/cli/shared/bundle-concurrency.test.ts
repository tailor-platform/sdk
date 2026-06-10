import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resolveBundleConcurrency, withBundleConcurrency } from "./bundle-concurrency";

describe("resolveBundleConcurrency", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("returns the number of CPUs when TAILOR_BUNDLE_CONCURRENCY is unset", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", undefined);
    expect(resolveBundleConcurrency()).toBe(Math.max(1, os.cpus().length));
  });

  test("returns the parsed env value when TAILOR_BUNDLE_CONCURRENCY is a positive integer", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "3");
    expect(resolveBundleConcurrency()).toBe(3);
  });

  test("trims whitespace when parsing TAILOR_BUNDLE_CONCURRENCY", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "  7  ");
    expect(resolveBundleConcurrency()).toBe(7);
  });

  test.each(["0", "-1", "abc", "1.5", ""])(
    "falls back to default for invalid value %j",
    (value) => {
      vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", value);
      expect(resolveBundleConcurrency()).toBe(Math.max(1, os.cpus().length));
    },
  );

  test("returns at least 1", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", undefined);
    expect(resolveBundleConcurrency()).toBeGreaterThanOrEqual(1);
  });
});

describe("withBundleConcurrency", () => {
  // Fake timers keep these tests deterministic and independent of wall-clock
  // time. With real timers the worker delays below could exceed the 5s test
  // timeout on a loaded CI runner, producing flaky failures even though the
  // logic is correct; `runAllTimersAsync` drives the awaited setTimeouts instead.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  test("caps in-flight workers to TAILOR_BUNDLE_CONCURRENCY", async () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "2");
    let active = 0;
    let maxActive = 0;

    const items = Array.from({ length: 8 }, (_, i) => i);
    const pending = withBundleConcurrency(items, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return item * 2;
    });
    await vi.runAllTimersAsync();
    const results = await pending;

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  test("returns results in input order", async () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "4");
    const items = ["a", "b", "c", "d", "e"];
    const pending = withBundleConcurrency(items, async (item) => {
      // Intentionally vary completion order
      await new Promise((resolve) => setTimeout(resolve, items.length - items.indexOf(item)));
      return item.toUpperCase();
    });
    await vi.runAllTimersAsync();
    const results = await pending;

    expect(results).toEqual(["A", "B", "C", "D", "E"]);
  });

  test("handles empty input", async () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "4");
    const results = await withBundleConcurrency<number, number>([], async (item) => item);
    expect(results).toEqual([]);
  });
});
