import { afterEach, describe, expect, test } from "vitest";
import { byName, createApplyLimiter, resolveApplyConcurrency } from "./apply-concurrency";

describe("resolveApplyConcurrency", () => {
  const original = process.env.TAILOR_APPLY_CONCURRENCY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.TAILOR_APPLY_CONCURRENCY;
    } else {
      process.env.TAILOR_APPLY_CONCURRENCY = original;
    }
  });

  test("defaults to 16 when unset", () => {
    delete process.env.TAILOR_APPLY_CONCURRENCY;
    expect(resolveApplyConcurrency()).toBe(16);
  });

  test("honors a positive integer override", () => {
    process.env.TAILOR_APPLY_CONCURRENCY = "4";
    expect(resolveApplyConcurrency()).toBe(4);
  });

  test("ignores non-positive or non-numeric values", () => {
    for (const value of ["0", "-3", "abc", "1.5", "", "  "]) {
      process.env.TAILOR_APPLY_CONCURRENCY = value;
      expect(resolveApplyConcurrency()).toBe(16);
    }
  });
});

describe("createApplyLimiter", () => {
  const original = process.env.TAILOR_APPLY_CONCURRENCY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.TAILOR_APPLY_CONCURRENCY;
    } else {
      process.env.TAILOR_APPLY_CONCURRENCY = original;
    }
  });

  test("never runs more tasks concurrently than the cap", async () => {
    process.env.TAILOR_APPLY_CONCURRENCY = "2";
    const limit = createApplyLimiter();

    let active = 0;
    let peak = 0;
    const task = () =>
      limit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        await Promise.resolve();
        active -= 1;
      });

    await Promise.all(Array.from({ length: 10 }, task));
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("byName", () => {
  test("sorts items by name", () => {
    const items = [{ name: "ShipmentOrder" }, { name: "Shipment" }, { name: "ShipmentDocument" }];
    expect(items.toSorted(byName).map((i) => i.name)).toEqual([
      "Shipment",
      "ShipmentDocument",
      "ShipmentOrder",
    ]);
  });
});
