import * as os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBundleConcurrency, withBundleConcurrency } from "./bundle-concurrency";

describe("resolveBundleConcurrency", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the number of CPUs when TAILOR_BUNDLE_CONCURRENCY is unset", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", undefined);
    expect(resolveBundleConcurrency()).toBe(Math.max(1, os.cpus().length));
  });

  it("returns the parsed env value when TAILOR_BUNDLE_CONCURRENCY is a positive integer", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "3");
    expect(resolveBundleConcurrency()).toBe(3);
  });

  it("trims whitespace when parsing TAILOR_BUNDLE_CONCURRENCY", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "  7  ");
    expect(resolveBundleConcurrency()).toBe(7);
  });

  it.each(["0", "-1", "abc", "1.5", ""])("falls back to default for invalid value %j", (value) => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", value);
    expect(resolveBundleConcurrency()).toBe(Math.max(1, os.cpus().length));
  });

  it("returns at least 1", () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", undefined);
    expect(resolveBundleConcurrency()).toBeGreaterThanOrEqual(1);
  });
});

describe("withBundleConcurrency", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caps in-flight workers to TAILOR_BUNDLE_CONCURRENCY", async () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "2");
    let active = 0;
    let maxActive = 0;

    const items = Array.from({ length: 8 }, (_, i) => i);
    const results = await withBundleConcurrency(items, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return item * 2;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("returns results in input order", async () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "4");
    const items = ["a", "b", "c", "d", "e"];
    const results = await withBundleConcurrency(items, async (item) => {
      // Intentionally vary completion order
      await new Promise((resolve) => setTimeout(resolve, items.length - items.indexOf(item)));
      return item.toUpperCase();
    });
    expect(results).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("handles empty input", async () => {
    vi.stubEnv("TAILOR_BUNDLE_CONCURRENCY", "4");
    const results = await withBundleConcurrency<number, number>([], async (item) => item);
    expect(results).toEqual([]);
  });
});
