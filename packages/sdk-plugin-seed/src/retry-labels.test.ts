import { describe, expect, test } from "vitest";
import { hashChunkArgs, readRetryLabels, toRetryLabels } from "./retry-labels";

const PLATFORM_LABEL_VALUE = /^$|^[a-z][a-z0-9_-]{0,62}$/;
const record = {
  chunkIndex: 1,
  total: 3,
  hash: hashChunkArgs([{ data: { User: [{ id: "u1" }] } }]),
  upsert: false,
  failedAt: 1_792_000_000,
};

describe("retry labels", () => {
  test("round-trips the record of a failed chunk", () => {
    expect(readRetryLabels(toRetryLabels(record))).toEqual(record);
  });

  test("round-trips an upsert run", () => {
    expect(readRetryLabels(toRetryLabels({ ...record, upsert: true }))?.upsert).toBe(true);
  });

  test("writes only values the platform accepts as label values", () => {
    for (const value of Object.values(toRetryLabels(record))) {
      expect(value).toMatch(PLATFORM_LABEL_VALUE);
    }
  });

  test("reads nothing from the labels of a workflow that holds no record", () => {
    expect(readRetryLabels({ "sdk-name": "my-app" })).toBeUndefined();
  });

  test("reads nothing from a record that is missing a label", () => {
    const { "seed-retry-hash": _hash, ...partial } = toRetryLabels(record);

    expect(readRetryLabels(partial)).toBeUndefined();
  });

  test("reads nothing from a chunk number that is not a number", () => {
    expect(readRetryLabels({ ...toRetryLabels(record), "seed-retry-chunk": "cx" })).toBeUndefined();
  });
});

describe("hashChunkArgs", () => {
  test("gives the same hash for the same chunk arguments", () => {
    expect(hashChunkArgs([{ a: 1 }, { b: 2 }])).toBe(hashChunkArgs([{ a: 1 }, { b: 2 }]));
  });

  test("changes when a chunk's data changes", () => {
    expect(hashChunkArgs([{ data: { User: [{ id: "u1" }] } }])).not.toBe(
      hashChunkArgs([{ data: { User: [{ id: "u2" }] } }]),
    );
  });

  test("changes when the chunks are split differently", () => {
    expect(hashChunkArgs([{ rows: [1, 2] }])).not.toBe(
      hashChunkArgs([{ rows: [1] }, { rows: [2] }]),
    );
  });

  test("stays within what fits a label value", () => {
    expect(`h${hashChunkArgs([])}`).toMatch(PLATFORM_LABEL_VALUE);
  });
});
