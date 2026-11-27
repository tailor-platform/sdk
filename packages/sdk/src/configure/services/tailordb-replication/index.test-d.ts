import { assertType, describe, test } from "vitest";
import { defineConfig } from "#/configure/config/index";
import { db } from "#/configure/services/tailordb/schema";
import { defineTailorDBReplicationDestination, type TailorDBReplicationConfig } from "./index";

const table = db.table("User", {
  name: db.string(),
  email: db.string(),
  embedding: db.string().vector(),
});

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

describe(".replication() types", () => {
  test("accepts the table's field names in either list", () => {
    assertType(table.replication({ excludeFields: ["email", "embedding"] }));
    assertType(table.replication({ includeFields: ["name"], targets: ["analytics"] }));
    assertType(table.replication({}, { targets: ["lake"], excludeFields: ["email"] }));
  });

  test("rejects a field the table does not have", () => {
    // @ts-expect-error "phone" is not a field of User
    assertType(table.replication({ excludeFields: ["phone"] }));
  });

  test("rejects id, which is always replicated", () => {
    // @ts-expect-error id is always replicated
    assertType(table.replication({ excludeFields: ["id"] }));
  });

  test("rejects both lists in one entry", () => {
    // @ts-expect-error at most one of excludeFields and includeFields
    assertType(table.replication({ excludeFields: ["email"], includeFields: ["name"] }));
  });

  test("rejects a vector field in includeFields", () => {
    // @ts-expect-error vector fields are never replicated
    assertType(table.replication({ includeFields: ["embedding"] }));
  });

  test("rejects a second call", () => {
    // @ts-expect-error .replication() can be set once
    assertType(table.replication({}).replication({}));
  });
});

describe("namespace replications", () => {
  test("accept defined destinations and undefined values", () => {
    assertType(
      defineConfig({
        name: "shop",
        db: {
          "main-db": {
            files: [],
            replications: {
              analytics: { destination: warehouse, tablePrefix: "shop_" },
              lake: undefined,
            },
          },
        },
      }),
    );
  });

  test("reject a destination that is not defined", () => {
    assertType(
      defineConfig({
        name: "shop",
        db: {
          "main-db": {
            files: [],
            replications: {
              // @ts-expect-error only defineTailorDBReplicationDestination() results
              analytics: { destination: "warehouse" },
            },
          },
        },
      }),
    );
  });
});

describe("replication pluginTables", () => {
  test("accept the field lists of .replication() without targets", () => {
    assertType(
      defineConfig({
        name: "shop",
        db: {
          "main-db": {
            files: [],
            replications: {
              analytics: {
                destination: warehouse,
                pluginTables: {
                  AuditLog: { excludeFields: ["ip"] },
                  Setting: { includeFields: ["name"] },
                  DeletedOrder: {},
                },
              },
            },
          },
        },
      }),
    );
  });

  test("reject both lists, targets, and a nested replication", () => {
    const replication: TailorDBReplicationConfig = {
      destination: warehouse,
      pluginTables: {
        // @ts-expect-error at most one of excludeFields and includeFields
        AuditLog: { excludeFields: ["ip"], includeFields: ["action"] },
        // @ts-expect-error a replication's pluginTables lists tables for that replication only
        Setting: { targets: ["lake"] },
        // @ts-expect-error an entry is a field list
        DeletedOrder: { replication: false },
      },
    };
    assertType(replication);
  });
});
