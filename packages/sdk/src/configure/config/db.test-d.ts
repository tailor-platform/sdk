import { test, expectTypeOf } from "vitest";
import { defineConfig } from "./index";

test("accepts explicit subgraph membership with optional definitions", () => {
  const config = defineConfig({
    name: "app",
    db: {
      own: { files: [] },
      legacy: { external: true },
      visible: { subgraph: true },
      shared: { subgraph: true, schemaFrom: "owner.ts" },
      sql: { subgraph: false, schemaFrom: "owner.ts" },
    },
  });
  expectTypeOf(config.db.sql.subgraph).toEqualTypeOf<false>();
});

test("rejects incompatible namespace options", () => {
  const ownedSubgraph = { files: [], subgraph: true as const };
  const ownedReference = { files: [], schemaFrom: "owner.ts" };
  const ownedExternal = { files: [], external: true as const };
  const noDefinitions = { subgraph: false as const };
  const noMembership = { schemaFrom: "owner.ts" };
  const legacySubgraph = { external: true as const, subgraph: true as const };
  const legacyReference = { external: true as const, schemaFrom: "owner.ts" };
  const ignores = { subgraph: true as const, ignores: [] };
  const migration = { subgraph: true as const, migration: { directory: "migrations" } };
  const gqlOperations = { subgraph: true as const, gqlOperations: {} };

  // @ts-expect-error Owned definitions cannot select subgraph membership.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ownedSubgraph } })).toBeObject();
  // @ts-expect-error Owned definitions cannot reference another config.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ownedReference } })).toBeObject();
  // @ts-expect-error Owned definitions cannot be external.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ownedExternal } })).toBeObject();
  // @ts-expect-error Non-subgraph namespaces require definitions.
  expectTypeOf(defineConfig({ name: "app", db: { ns: noDefinitions } })).toBeObject();
  // @ts-expect-error Referenced namespaces require explicit membership.
  expectTypeOf(defineConfig({ name: "app", db: { ns: noMembership } })).toBeObject();
  // @ts-expect-error Legacy and explicit membership cannot be combined.
  expectTypeOf(defineConfig({ name: "app", db: { ns: legacySubgraph } })).toBeObject();
  // @ts-expect-error Legacy entries cannot reference definitions.
  expectTypeOf(defineConfig({ name: "app", db: { ns: legacyReference } })).toBeObject();
  // @ts-expect-error Non-owned namespaces cannot configure file discovery.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ignores } })).toBeObject();
  // @ts-expect-error Non-owned namespaces cannot configure migrations.
  expectTypeOf(defineConfig({ name: "app", db: { ns: migration } })).toBeObject();
  // @ts-expect-error Non-owned namespaces cannot configure GraphQL operations.
  expectTypeOf(defineConfig({ name: "app", db: { ns: gqlOperations } })).toBeObject();
});
