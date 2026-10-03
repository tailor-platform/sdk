import { test, expectTypeOf } from "vitest";
import { defineConfig } from "./index";

test("accepts explicit app attachment with optional definitions", () => {
  const config = defineConfig({
    name: "app",
    db: {
      own: { files: [] },
      legacy: { external: true },
      visible: { attach: true },
      shared: { attach: true, schemaFrom: "owner.ts" },
      sql: { attach: false, schemaFrom: "owner.ts" },
    },
  });
  expectTypeOf(config.db.sql.attach).toEqualTypeOf<false>();
});

test("rejects incompatible namespace options", () => {
  const ownedAttachment = { files: [], attach: true as const };
  const ownedReference = { files: [], schemaFrom: "owner.ts" };
  const ownedExternal = { files: [], external: true as const };
  const noDefinitions = { attach: false as const };
  const noMembership = { schemaFrom: "owner.ts" };
  const legacyAttachment = { external: true as const, attach: true as const };
  const legacyReference = { external: true as const, schemaFrom: "owner.ts" };
  const ignores = { attach: true as const, ignores: [] };
  const migration = { attach: true as const, migration: { directory: "migrations" } };
  const gqlOperations = { attach: true as const, gqlOperations: {} };

  // @ts-expect-error Owned definitions cannot configure app attachment.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ownedAttachment } })).toBeObject();
  // @ts-expect-error Owned definitions cannot reference another config.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ownedReference } })).toBeObject();
  // @ts-expect-error Owned definitions cannot be external.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ownedExternal } })).toBeObject();
  // @ts-expect-error Unattached namespaces require definitions.
  expectTypeOf(defineConfig({ name: "app", db: { ns: noDefinitions } })).toBeObject();
  // @ts-expect-error Referenced namespaces require explicit attachment.
  expectTypeOf(defineConfig({ name: "app", db: { ns: noMembership } })).toBeObject();
  // @ts-expect-error Legacy and explicit attachment cannot be combined.
  expectTypeOf(defineConfig({ name: "app", db: { ns: legacyAttachment } })).toBeObject();
  // @ts-expect-error Legacy entries cannot reference definitions.
  expectTypeOf(defineConfig({ name: "app", db: { ns: legacyReference } })).toBeObject();
  // @ts-expect-error Non-owned namespaces cannot configure file discovery.
  expectTypeOf(defineConfig({ name: "app", db: { ns: ignores } })).toBeObject();
  // @ts-expect-error Non-owned namespaces cannot configure migrations.
  expectTypeOf(defineConfig({ name: "app", db: { ns: migration } })).toBeObject();
  // @ts-expect-error Non-owned namespaces cannot configure GraphQL operations.
  expectTypeOf(defineConfig({ name: "app", db: { ns: gqlOperations } })).toBeObject();
});
