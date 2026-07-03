import { describe, test, expect } from "vitest";
import {
  chunkSeedData,
  DEFAULT_MAX_MESSAGE_SIZE,
  type SeedChunk,
  type SeedData,
} from "./seed-chunker";

const makeRecords = (count: number, padSize: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    description: "x".repeat(padSize),
  }));

const jsonByteSize = (data: SeedData, order: string[]) =>
  new TextEncoder().encode(JSON.stringify({ data, order })).length;

const expectSequentialIndices = (chunks: SeedChunk[]) => {
  for (let i = 0; i < chunks.length; i++) {
    expect(chunks[i]!.index).toBe(i);
    expect(chunks[i]!.total).toBe(chunks.length);
  }
};

describe("chunkSeedData", () => {
  test("returns single chunk when data fits within budget", () => {
    const data: SeedData = {
      User: [{ id: "1", name: "Alice" }],
      Order: [{ id: "1", userId: "1" }],
    };

    const chunks = chunkSeedData({
      data,
      order: ["User", "Order"],
      codeByteSize: 1000,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.data).toEqual(data);
    expect(chunks[0]!.order).toEqual(["User", "Order"]);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.total).toBe(1);
  });

  test("returns empty array when no data to seed", () => {
    const chunks = chunkSeedData({
      data: {},
      order: [],
      codeByteSize: 1000,
    });

    expect(chunks).toHaveLength(0);
  });

  test("returns empty array when all types have empty arrays", () => {
    const chunks = chunkSeedData({
      data: { User: [], Order: [] },
      order: ["User", "Order"],
      codeByteSize: 1000,
    });

    expect(chunks).toHaveLength(0);
  });

  test("splits data at type boundaries when exceeding budget", () => {
    const largeRecords = makeRecords(100, 200);
    const order = ["TypeA", "TypeB", "TypeC"];
    const data: SeedData = { TypeA: largeRecords, TypeB: largeRecords, TypeC: largeRecords };
    const fullSize = jsonByteSize(data, order);

    const chunks = chunkSeedData({
      data,
      order,
      codeByteSize: 1000,
      maxMessageSize: Math.floor(fullSize / 2) + 2000,
    });

    expect(chunks.length).toBeGreaterThan(1);

    const allTypes = new Set(chunks.flatMap((c) => c.order));
    expect(allTypes).toEqual(new Set(order));

    expectSequentialIndices(chunks);

    const totalRecords = chunks.reduce((sum, chunk) => {
      return sum + Object.values(chunk.data).reduce((s, records) => s + records.length, 0);
    }, 0);
    expect(totalRecords).toBe(300);
  });

  test("preserves dependency order across chunks", () => {
    const data: SeedData = {
      Base: makeRecords(50, 100),
      Child: makeRecords(50, 100),
      GrandChild: makeRecords(50, 100),
    };

    const order = ["Base", "Child", "GrandChild"];
    const fullSize = jsonByteSize(data, order);

    const chunks = chunkSeedData({
      data,
      order,
      codeByteSize: 1000,
      maxMessageSize: Math.floor(fullSize / 2) + 2000,
    });

    // Verify order is maintained: each chunk's order items should appear
    // in the same relative order as the original
    const flatOrder = chunks.flatMap((c) => c.order);
    const uniqueOrder = [...new Set(flatOrder)];

    for (let i = 0; i < uniqueOrder.length - 1; i++) {
      const idxA = order.indexOf(uniqueOrder[i]!);
      const idxB = order.indexOf(uniqueOrder[i + 1]!);
      expect(idxA).toBeLessThanOrEqual(idxB);
    }
  });

  test("splits records within a single large type", () => {
    const largeRecords = makeRecords(200, 500);
    const data: SeedData = { HugeType: largeRecords };
    const singleTypeSize = jsonByteSize(data, ["HugeType"]);

    const chunks = chunkSeedData({
      data,
      order: ["HugeType"],
      codeByteSize: 1000,
      maxMessageSize: Math.floor(singleTypeSize / 3) + 2000,
    });

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.order).toEqual(["HugeType"]);
      expect(Object.keys(chunk.data)).toEqual(["HugeType"]);
    }

    const totalRecords = chunks.reduce((sum, chunk) => sum + chunk.data["HugeType"]!.length, 0);
    expect(totalRecords).toBe(200);

    expectSequentialIndices(chunks);
  });

  test("throws error when codeByteSize exceeds maxMessageSize", () => {
    expect(() =>
      chunkSeedData({
        data: { User: [{ id: "1" }] },
        order: ["User"],
        codeByteSize: 4_000_000,
        maxMessageSize: 3_500_000,
      }),
    ).toThrow("Code size (4000000 bytes) exceeds the message size limit (3500000 bytes)");
  });

  test("throws error when a single record exceeds budget", () => {
    const hugeRecord = { id: "1", payload: "x".repeat(1_000_000) };

    expect(() =>
      chunkSeedData({
        data: { HugeType: [hugeRecord] },
        order: ["HugeType"],
        codeByteSize: 1000,
        maxMessageSize: 100_000,
      }),
    ).toThrow(/single record in type "HugeType"/);
  });

  test("uses default maxMessageSize when not specified", () => {
    const data: SeedData = {
      User: [{ id: "1" }],
    };

    const chunks = chunkSeedData({
      data,
      order: ["User"],
      codeByteSize: 1000,
    });

    expect(chunks).toHaveLength(1);
    // Verify default is used (data is small, so it should fit)
    expect(DEFAULT_MAX_MESSAGE_SIZE).toBe(3.5 * 1024 * 1024);
  });

  test("skips types not in data", () => {
    const data: SeedData = {
      User: [{ id: "1" }],
    };

    const chunks = chunkSeedData({
      data,
      order: ["User", "MissingType"],
      codeByteSize: 1000,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.order).toEqual(["User", "MissingType"]);
  });

  test("handles types with data but listed in order without data", () => {
    const data: SeedData = {
      User: [{ id: "1" }],
      EmptyType: [],
    };

    const chunks = chunkSeedData({
      data,
      order: ["User", "EmptyType"],
      codeByteSize: 1000,
    });

    expect(chunks).toHaveLength(1);
  });

  test("each chunk fits within the message size budget", () => {
    const largeRecords = makeRecords(500, 300);

    const data: SeedData = {
      TypeA: largeRecords.slice(0, 200),
      TypeB: largeRecords.slice(200, 400),
      TypeC: largeRecords.slice(400, 500),
    };

    const maxMessageSize = 50_000;
    const codeByteSize = 5000;

    const chunks = chunkSeedData({
      data,
      order: ["TypeA", "TypeB", "TypeC"],
      codeByteSize,
      maxMessageSize,
    });

    const argBudget = maxMessageSize - codeByteSize - 1024;

    for (const chunk of chunks) {
      expect(jsonByteSize(chunk.data, chunk.order)).toBeLessThanOrEqual(argBudget);
    }
  });
});
