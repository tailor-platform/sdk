import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { defineTailorDBReplication, defineTailorDBReplicationDestination } from "./index";

const user = db.table("User", { name: db.string(), email: db.string() });
const order = db.table("Order", { total: db.int() });

describe("defineTailorDBReplicationDestination", () => {
  test("returns the given name and config", () => {
    expect(
      defineTailorDBReplicationDestination("warehouse", {
        bigquery: { project: "acme-analytics", dataset: "tailor" },
      }),
    ).toEqual({
      name: "warehouse",
      bigquery: { project: "acme-analytics", dataset: "tailor" },
    });
  });
});

describe("defineTailorDBReplication", () => {
  const warehouse = defineTailorDBReplicationDestination("warehouse", {
    bigquery: { project: "acme-analytics", dataset: "tailor" },
  });
  const empty = defineTailorDBReplication("analytics", {
    source: { namespace: "main-db" },
    destination: warehouse,
  });

  test("starts with no types", () => {
    expect(empty).toEqual({
      name: "analytics",
      source: { namespace: "main-db" },
      destination: warehouse,
      types: [],
    });
  });

  test("add returns a new replication and leaves the original unchanged", () => {
    const withUser = empty.add(user, { excludeFields: ["email"] });
    const withBoth = withUser.add(order);

    expect(empty.types).toEqual([]);
    expect(withUser.types).toEqual([{ name: "User", excludeFields: ["email"] }]);
    expect(withBoth.types).toEqual([{ name: "User", excludeFields: ["email"] }, { name: "Order" }]);
  });

  test("copies the field list instead of keeping the caller's array", () => {
    const includeFields: "name"[] = ["name"];
    const replication = empty.add(user, { includeFields });
    includeFields.length = 0;

    expect(replication.types).toEqual([{ name: "User", includeFields: ["name"] }]);
  });

  test("keeps add out of the replication's enumerable keys", () => {
    expect(Object.keys(empty.add(user))).not.toContain("add");
  });
});
