import { assertType, describe, expectTypeOf, test } from "vitest";
import { defineConfig } from "#/configure/config/index";
import { db } from "#/configure/services/tailordb/schema";
import { defineTailorDBReplication, defineTailorDBReplicationDestination } from "./index";
import type { TailorDBReplicationConfig } from "./types";

const user = db.table("User", {
  name: db.string(),
  email: db.string(),
  embedding: db.string().vector(),
});

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

const replication = defineTailorDBReplication("analytics", {
  source: { namespace: "main-db" },
  destination: warehouse,
});

describe("TailorDB replication types", () => {
  test("accepts the type's field names in either list", () => {
    assertType<TailorDBReplicationConfig>(
      replication.add(user, { excludeFields: ["email", "embedding"] }),
    );
    assertType<TailorDBReplicationConfig>(replication.add(user, { includeFields: ["name"] }));
    assertType<TailorDBReplicationConfig>(replication.add(user));
  });

  test("rejects a field the type does not have", () => {
    // @ts-expect-error "phone" is not a field of User
    assertType<TailorDBReplicationConfig>(replication.add(user, { excludeFields: ["phone"] }));
  });

  test("rejects id, which is always replicated", () => {
    // @ts-expect-error id is always replicated
    assertType<TailorDBReplicationConfig>(replication.add(user, { excludeFields: ["id"] }));
  });

  test("rejects both lists at once", () => {
    assertType<TailorDBReplicationConfig>(
      // @ts-expect-error at most one of excludeFields and includeFields
      replication.add(user, { excludeFields: ["email"], includeFields: ["name"] }),
    );
  });

  test("rejects a vector field in includeFields", () => {
    // @ts-expect-error vector fields are never replicated
    assertType<TailorDBReplicationConfig>(replication.add(user, { includeFields: ["embedding"] }));
  });

  test("add returns the same type as the replication it was called on", () => {
    expectTypeOf(replication.add(user)).toEqualTypeOf(replication);
  });

  test("rejects a destination given by name", () => {
    assertType(
      defineTailorDBReplication("analytics", {
        source: { namespace: "main-db" },
        // @ts-expect-error pass the destination itself
        destination: "warehouse",
      }),
    );
  });

  test("defineConfig accepts only defined replications and destinations", () => {
    assertType(
      defineConfig({
        name: "shop",
        dbReplications: [replication.add(user)],
      }),
    );
    assertType(
      defineConfig({
        name: "shop",
        dbReplicationDestinations: [
          // @ts-expect-error only defineTailorDBReplicationDestination() results
          { name: "warehouse", bigquery: { project: "acme-analytics", dataset: "tailor" } },
        ],
      }),
    );
  });
});
