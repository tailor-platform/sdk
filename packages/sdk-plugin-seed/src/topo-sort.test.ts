import { describe, expect, test } from "vitest";
import { topologicalSort } from "./topo-sort";

describe("topologicalSort", () => {
  test("orders dependencies before dependents", () => {
    const sorted = topologicalSort(["Order", "User"], { Order: ["User"], User: [] });
    expect(sorted).toEqual(["User", "Order"]);
  });

  test("ignores dependencies outside the input list", () => {
    const sorted = topologicalSort(["Order"], { Order: ["User"] });
    expect(sorted).toEqual(["Order"]);
  });

  test("keeps input order for independent types", () => {
    const sorted = topologicalSort(["B", "A"], {});
    expect(sorted).toEqual(["B", "A"]);
  });

  test("terminates on circular dependencies", () => {
    const sorted = topologicalSort(["A", "B"], { A: ["B"], B: ["A"] });
    expect(sorted).toHaveLength(2);
    expect(sorted).toEqual(expect.arrayContaining(["A", "B"]));
  });
});
