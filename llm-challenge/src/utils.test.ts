import { describe, expect, test } from "vitest";
import { runWithConcurrency } from "./utils";

describe("runWithConcurrency", () => {
  test("starts no further item once a worker requests a stop, and lets running items finish", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    await runWithConcurrency([0, 1, 2, 3, 4], 2, async (item, control) => {
      started.push(item);
      if (item === 0) {
        await Promise.resolve();
        control.stop();
        await firstGate;
      } else {
        await Promise.resolve();
        releaseFirst();
      }
      finished.push(item);
    });

    expect(started).toEqual([0, 1]);
    expect(finished.toSorted((left, right) => left - right)).toEqual([0, 1]);
  });

  test("runs every item when no worker requests a stop", async () => {
    const started: number[] = [];

    await runWithConcurrency([0, 1, 2], 2, async (item) => {
      started.push(item);
    });

    expect(started.toSorted((left, right) => left - right)).toEqual([0, 1, 2]);
  });
});
