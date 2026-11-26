import { describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { defineTailorDBReplicationDestination } from "./index";

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

describe("db.table().replication()", () => {
  test("records each entry in the table's metadata", () => {
    const user = db
      .table("User", { name: db.string(), email: db.string() })
      .replication({ excludeFields: ["email"] }, { targets: ["lake"], includeFields: ["name"] });

    expect(user.metadata.replication).toEqual([
      { excludeFields: ["email"] },
      { targets: ["lake"], includeFields: ["name"] },
    ]);
  });

  test("leaves the metadata without replication when it is not called", () => {
    expect(db.table("User", { name: db.string() }).metadata).not.toHaveProperty("replication");
  });

  test("copies the lists instead of keeping the caller's arrays", () => {
    const excludeFields: "email"[] = ["email"];
    const user = db
      .table("User", { name: db.string(), email: db.string() })
      .replication({ excludeFields });
    excludeFields.length = 0;

    expect(user.metadata.replication).toEqual([{ excludeFields: ["email"] }]);
  });

  test("can be called once", () => {
    const user = db.table("User", { name: db.string() }).replication({});

    expect(() => (user as { replication: (entry: object) => unknown }).replication({})).toThrow(
      ".replication() has already been set",
    );
  });
});
