import { describe, expect, test } from "vitest";
import { groupBySelfReference, sortBySelfReference } from "./seed-order";

describe("sortBySelfReference", () => {
  test("orders a parent before children that land in reverse (dump) order", () => {
    // Dumped rows are ordered by uuid `id`, not by parent/child relationship,
    // so a child can sort before the parent it references.
    const records = [
      { id: "child", parentId: "parent" },
      { id: "parent", parentId: null },
    ];
    const sorted = sortBySelfReference(records, ["parentId"]);
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
    const sorted = sortBySelfReference(records, ["parentId"]);
    expect(sorted.map((r) => r.id)).toEqual(["parent", "child", "grandchild"]);
  });

  test("ignores a reference to an id outside the batch", () => {
    const records = [
      { id: "child", parentId: "not-in-batch" },
      { id: "independent", parentId: null },
    ];
    const sorted = sortBySelfReference(records, ["parentId"]);
    expect(sorted).toEqual(records);
  });

  test("ignores self edges when ordering a parent and child", () => {
    const records = [
      { id: "child", parentId: "parent" },
      { id: "parent", parentId: "parent" },
    ];
    expect(sortBySelfReference(records, ["parentId"]).map((record) => record.id)).toEqual([
      "parent",
      "child",
    ]);
  });

  test("ignores nullable nested values while resolving the other references", () => {
    const records = [
      { id: "child", links: [null, {}, { parentId: "parent" }] },
      { id: "parent", links: null },
    ];
    expect(sortBySelfReference(records, ["links.parentId"]).map((record) => record.id)).toEqual([
      "parent",
      "child",
    ]);
  });

  test("falls back to original order when ids are missing", () => {
    const records = [{ parentId: null }, { parentId: null }];
    const sorted = sortBySelfReference(records, ["parentId"]);
    expect(sorted).toEqual(records);
  });

  test("falls back to original order when ids are duplicated", () => {
    const records = [
      { id: "dup", parentId: null },
      { id: "dup", parentId: null },
    ];
    const sorted = sortBySelfReference(records, ["parentId"]);
    expect(sorted).toEqual(records);
  });

  test("appends a cycle in original order instead of dropping it", () => {
    const records = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    const sorted = sortBySelfReference(records, ["parentId"]);
    expect(sorted).toHaveLength(2);
    expect(sorted.map((r) => r.id)).toEqual(expect.arrayContaining(["a", "b"]));
  });

  test("returns records unchanged when there are no self-reference fields", () => {
    const records = [{ id: "a" }, { id: "b" }];
    expect(sortBySelfReference(records, [])).toBe(records);
  });

  test("orders a parent before a child that points at it from inside a nested object", () => {
    const records = [{ id: "child", link: { parentID: "parent" } }, { id: "parent" }];
    const sorted = sortBySelfReference(records, ["link.parentID"]);
    expect(sorted.map((r) => r.id)).toEqual(["parent", "child"]);
  });

  test("waits for every parent that elements of a nested array point at", () => {
    const records = [
      { id: "c", links: [{ parentID: "a" }, { parentID: "b" }] },
      { id: "b", links: [{ parentID: "a" }] },
      { id: "a", links: [] },
    ];
    const sorted = sortBySelfReference(records, ["links.parentID"]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("resolves a reference inside a nested object through a non-id target key", () => {
    const records = [
      { id: "child-id", code: "child", link: { parentCode: "parent" } },
      { id: "parent-id", code: "parent", link: { parentCode: null } },
    ];
    const sorted = sortBySelfReference(records, ["link.parentCode"], {
      "link.parentCode": "code",
    });
    expect(sorted.map((r) => r.code)).toEqual(["parent", "child"]);
  });

  test("resolves edges through a non-id target key", () => {
    // A self-reference doesn't always point at the parent's `id` — it can be
    // keyed to another unique field (e.g. `code`). Without fieldKeys, the
    // parentCode value would never match anything in an id-keyed lookup, so
    // no edge would ever be found and the rows would fall back to file order.
    const records = [
      { id: "child-id", code: "child", parentCode: "parent" },
      { id: "parent-id", code: "parent", parentCode: null },
    ];
    const sorted = sortBySelfReference(records, ["parentCode"], { parentCode: "code" });
    expect(sorted.map((r) => r.code)).toEqual(["parent", "child"]);
  });

  test("falls back to file order for a non-id key with no fieldKeys entry", () => {
    const records = [
      { id: "child-id", code: "child", parentCode: "parent" },
      { id: "parent-id", code: "parent", parentCode: null },
    ];
    // Without a fieldKeys entry, parentCode is (wrongly) matched against id,
    // so neither row finds its parent and both are treated as roots — but
    // no data is dropped.
    const sorted = sortBySelfReference(records, ["parentCode"]);
    expect(sorted.map((r) => r.id)).toEqual(expect.arrayContaining(["child-id", "parent-id"]));
  });
});

describe("groupBySelfReference", () => {
  const ids = (groups: { id?: string }[][]) => groups.map((group) => group.map((r) => r.id));

  test("puts rows whose parents are all in earlier groups into the same group", () => {
    const records = [
      { id: "e", parentId: "c" },
      { id: "d", parentId: "b" },
      { id: "c", parentId: "a" },
      { id: "b", parentId: "a" },
      { id: "a", parentId: null },
    ];
    expect(ids(groupBySelfReference(records, ["parentId"]))).toEqual([
      ["a"],
      ["c", "b"],
      ["e", "d"],
    ]);
  });

  test("places a row after the deepest of its parents", () => {
    const records = [
      { id: "c", links: [{ parentID: "a" }, { parentID: "b" }] },
      { id: "b", links: [{ parentID: "a" }] },
      { id: "a", links: [] },
    ];
    expect(ids(groupBySelfReference(records, ["links.parentID"]))).toEqual([["a"], ["b"], ["c"]]);
  });

  test("keeps rows that reference nothing in the batch, or only themselves, in one group", () => {
    const records = [
      { id: "outside", parentId: "not-in-batch" },
      { id: "self", parentId: "self" },
      { id: "root", parentId: null },
    ];
    expect(ids(groupBySelfReference(records, ["parentId"]))).toEqual([["outside", "self", "root"]]);
  });

  test("resolves references through a non-id target key", () => {
    const records = [
      { id: "child-id", code: "child", parentCode: "parent" },
      { id: "parent-id", code: "parent", parentCode: null },
    ];
    const groups = groupBySelfReference(records, ["parentCode"], { parentCode: "code" });
    expect(groups.map((group) => group.map((r) => r.code))).toEqual([["parent"], ["child"]]);
  });

  test("returns one group per row, in input order, when there are no self-reference fields", () => {
    const records = [{ id: "a" }, { id: "b" }];
    expect(ids(groupBySelfReference(records, []))).toEqual([["a"], ["b"]]);
  });

  test("returns one group per row, in input order, when ids are duplicated", () => {
    const records = [
      { id: "dup", parentId: null },
      { id: "dup", parentId: null },
    ];
    expect(ids(groupBySelfReference(records, ["parentId"]))).toEqual([["dup"], ["dup"]]);
  });

  test("returns a cycle as one group per row after the rows that can be grouped", () => {
    const records = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
      { id: "root", parentId: null },
    ];
    expect(ids(groupBySelfReference(records, ["parentId"]))).toEqual([["root"], ["a"], ["b"]]);
  });

  test("returns no groups for no rows", () => {
    expect(groupBySelfReference([], ["parentId"])).toEqual([]);
  });
});
