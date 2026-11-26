import { assertType, describe, expectTypeOf, test } from "vitest";
import { defineConfig } from "#/configure/config/index";
import { db } from "#/configure/services/tailordb/schema";
import {
  defineTailorDBReplicationDestination,
  type TailorDBPluginTableConfig,
  type TailorDBPluginTablesConfig,
} from "./index";

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

describe("namespace pluginTables", () => {
  test("accept .replication() entries and false", () => {
    assertType(
      defineConfig({
        name: "shop",
        db: {
          "main-db": {
            files: [],
            pluginTables: {
              AuditLog: { replication: [{ targets: ["analytics"], excludeFields: ["ip"] }] },
              DeletedOrder: { replication: false },
              Setting: {},
            },
          },
        },
      }),
    );
  });

  test("reject an empty list", () => {
    assertType(
      defineConfig({
        name: "shop",
        // @ts-expect-error list at least one entry, or false
        db: { "main-db": { files: [], pluginTables: { AuditLog: { replication: [] } } } },
      }),
    );
  });

  test("reject both lists in one entry", () => {
    const pluginTables: TailorDBPluginTablesConfig = {
      // @ts-expect-error at most one of excludeFields and includeFields
      AuditLog: { replication: [{ excludeFields: ["ip"], includeFields: ["action"] }] },
    };
    assertType(pluginTables);
  });

  test("take one table's settings as TailorDBPluginTableConfig", () => {
    expectTypeOf<TailorDBPluginTablesConfig>().toEqualTypeOf<
      Record<string, TailorDBPluginTableConfig>
    >();
  });
});
