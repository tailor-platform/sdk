import { describe, expect, test } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION, type FieldModifiedChange } from "./diff-calculator";
import {
  applyPreMigrationFieldAdjustments,
  buildPreMigrationSnapshot,
} from "./pre-migration-schema";
import { processNestedFieldsFromSnapshot } from "./snapshot-manifest";
import { createMockMigrationDiff } from "./test-helpers/migration-diff";
import type { SnapshotFieldConfig } from "./snapshot-types";

const before: SnapshotFieldConfig = {
  type: "nested",
  required: false,
  array: true,
  fields: {
    geo: {
      type: "nested",
      required: false,
      array: true,
      fields: {
        lat: { type: "float", required: false },
      },
    },
  },
};

function preField(mode: string, after: SnapshotFieldConfig, previous = before) {
  const change: FieldModifiedChange = {
    kind: "field_modified",
    tableName: "User",
    fieldName: "address",
    before: previous,
    after,
  };
  if (mode === "deploy") {
    const fields = processNestedFieldsFromSnapshot({ address: after });
    applyPreMigrationFieldAdjustments(fields, new Map([["address", change]]));
    return fields.address;
  }
  return buildPreMigrationSnapshot(
    {
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace: "tailordb",
      createdAt: "2026-01-01T00:00:00.000Z",
      tables: { User: { name: "User", pluralForm: "Users", fields: { address: previous } } },
    },
    createMockMigrationDiff({
      namespace: "tailordb",
      changes: [change],
      hasBreakingChanges: true,
      breakingChanges: [],
      requiresMigrationScript: true,
    }),
  ).tables.User!.fields.address;
}

describe.each(["deploy", "snapshot"])("%s Pre-phase nested constraints", (mode) => {
  test.each([true, false])(
    "keeps removed enum values readable (target values: %s)",
    (hasValues) => {
      const previous: SnapshotFieldConfig = {
        ...before,
        fields: {
          status: {
            type: "enum",
            required: false,
            allowedValues: [{ value: "old" }, { value: "keep" }],
          },
        },
      };
      const after: SnapshotFieldConfig = {
        ...before,
        fields: {
          status: {
            type: "enum",
            required: false,
            ...(hasValues && { allowedValues: [{ value: "keep" }, { value: "new" }] }),
          },
        },
      };
      expect(
        preField(mode, after, previous)?.fields?.status?.allowedValues?.map((v) => v.value),
      ).toEqual(hasValues ? ["old", "keep", "new"] : ["old", "keep"]);
      expect(after.fields?.status?.allowedValues?.map((v) => v.value)).toEqual(
        hasValues ? ["keep", "new"] : undefined,
      );
    },
  );

  test("defers required additions and requiredness changes inside object arrays", () => {
    const after: SnapshotFieldConfig = {
      ...before,
      fields: {
        geo: {
          type: "nested",
          required: false,
          array: true,
          fields: {
            lat: { type: "float", required: true },
            lng: { type: "float", required: true },
            region: {
              type: "nested",
              required: true,
              fields: {
                name: { type: "string", required: true },
              },
            },
          },
        },
      },
    };
    const pre = preField(mode, after);
    expect(pre?.fields?.geo?.fields).toMatchObject({
      lat: { required: false },
      lng: { required: false },
      region: { required: false, fields: { name: { required: true } } },
    });
    expect(after.fields?.geo?.fields?.lat?.required).toBe(true);
    expect(after.fields?.geo?.fields?.lng?.required).toBe(true);
  });
});

describe.each(["deploy", "snapshot"])("%s Pre-phase foreign keys", (mode) => {
  const reference = { foreignKey: true, foreignKeyType: "User", foreignKeyField: "id" } as const;
  const ownerId: SnapshotFieldConfig = { type: "uuid", required: false };

  test("withholds a foreign key the migration adds to an existing field", () => {
    const after = { ...ownerId, ...reference };
    const pre = preField(mode, after, ownerId);

    expect(pre).toMatchObject({ type: "uuid" });
    expect(pre).not.toHaveProperty("foreignKey");
    expect(pre).not.toHaveProperty("foreignKeyType");
    expect(pre).not.toHaveProperty("foreignKeyField");
    expect(after).toMatchObject(reference);
  });

  test("keeps a foreign key the migration adds to a nested member", () => {
    const nested = (owner: SnapshotFieldConfig): SnapshotFieldConfig => ({
      type: "nested",
      required: false,
      fields: { owner },
    });

    expect(
      preField(mode, nested({ ...ownerId, ...reference }), nested(ownerId))?.fields?.owner,
    ).toMatchObject(reference);
  });
});
