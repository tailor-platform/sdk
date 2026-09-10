import { describe, expect, test } from "vitest";
import { sortRecordsBySelfReference, topologicalSort } from "./topo-sort";

describe("topologicalSort", () => {
  test("orders dependencies before dependents", () => {
    const sorted = topologicalSort(["Order", "User"], { Order: ["User"], User: [] });
    expect(sorted).toEqual(["User", "Order"]);
  });

  test("ignores dependencies outside the input list", () => {
    const sorted = topologicalSort(["Order"], { Order: ["User"] });
    expect(sorted).toEqual(["Order"]);
  });

  test("keeps input order for independent tables", () => {
    const sorted = topologicalSort(["B", "A"], {});
    expect(sorted).toEqual(["B", "A"]);
  });

  test("terminates on circular dependencies", () => {
    const sorted = topologicalSort(["A", "B"], { A: ["B"], B: ["A"] });
    expect(sorted).toHaveLength(2);
    expect(sorted).toEqual(expect.arrayContaining(["A", "B"]));
  });
});

describe("sortRecordsBySelfReference", () => {
  test("orders a parent before children that land in reverse (dump) order", () => {
    // Dumped rows are ordered by uuid `id`, not by parent/child relationship,
    // so a child can sort before the parent it references.
    const records = [
      { id: "child", parentId: "parent" },
      { id: "parent", parentId: null },
    ];
    const sorted = sortRecordsBySelfReference(records, ["parentId"]);
    expect(sorted.map((r) => r.id)).toEqual(["parent", "child"]);
  });

  test("keeps a parent that would otherwise land in a later chunk ahead of its child", () => {
    // This is the scenario chunkSeedData can produce: a large self-referencing
    // table split by byte size across multiple script executions. Sorting the
    // whole table up front (before chunking) keeps every parent at or before
    // the chunk boundary of its children.
    const records = [
      { id: "grandchild", parentId: "child" },
      { id: "child", parentId: "parent" },
      { id: "parent", parentId: null },
    ];
    const sorted = sortRecordsBySelfReference(records, ["parentId"]);
    expect(sorted.map((r) => r.id)).toEqual(["parent", "child", "grandchild"]);
  });

  test("ignores a reference to an id outside the batch", () => {
    const records = [{ id: "child", parentId: "not-in-batch" }];
    const sorted = sortRecordsBySelfReference(records, ["parentId"]);
    expect(sorted).toEqual(records);
  });

  test("falls back to original order when ids are missing", () => {
    const records = [{ parentId: null }, { parentId: null }];
    const sorted = sortRecordsBySelfReference(records, ["parentId"]);
    expect(sorted).toEqual(records);
  });

  test("falls back to original order when ids are duplicated", () => {
    const records = [
      { id: "dup", parentId: null },
      { id: "dup", parentId: null },
    ];
    const sorted = sortRecordsBySelfReference(records, ["parentId"]);
    expect(sorted).toEqual(records);
  });

  test("appends a cycle in original order instead of dropping it", () => {
    const records = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    const sorted = sortRecordsBySelfReference(records, ["parentId"]);
    expect(sorted).toHaveLength(2);
    expect(sorted.map((r) => r.id)).toEqual(expect.arrayContaining(["a", "b"]));
  });

  test("returns records unchanged when there are no self-reference fields", () => {
    const records = [{ id: "a" }, { id: "b" }];
    expect(sortRecordsBySelfReference(records, [])).toBe(records);
  });
});
