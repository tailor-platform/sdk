import { describe, expect, it } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION, type DiffChange } from "./diff-calculator";
import {
  applyPreMigrationRelationshipAdjustments,
  buildPreMigrationRelationshipChangesMap,
} from "./pre-migration-schema";
import type { MigrationDiff } from "./diff-calculator";
import type { PendingMigration } from "./types";

function makeMigration(changes: DiffChange[]): PendingMigration {
  const diff: MigrationDiff = {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "ns",
    createdAt: "2026-01-01T00:00:00Z",
    changes,
    hasBreakingChanges: false,
    breakingChanges: [],
    hasWarnings: false,
    warnings: [],
    requiresMigrationScript: false,
  };
  return {
    number: 1,
    scriptPath: "/tmp/migrate.ts",
    hasScript: false,
    diffPath: "/tmp/diff.json",
    namespace: "ns",
    migrationsDir: "/tmp",
    diff,
  };
}

describe("buildPreMigrationRelationshipChangesMap", () => {
  it("collects relationship_removed entries keyed by typeName/relationshipName", () => {
    const migration = makeMigration([
      {
        kind: "relationship_removed",
        typeName: "Order",
        relationshipName: "user",
        relationshipType: "forward",
        before: {
          targetType: "User",
          targetField: "userId",
          sourceField: "userId",
          isArray: false,
          description: "",
        },
      },
      {
        kind: "relationship_added",
        typeName: "Order",
        relationshipName: "newRel",
        relationshipType: "forward",
        after: {
          targetType: "Other",
          targetField: "otherId",
          sourceField: "otherId",
          isArray: false,
          description: "",
        },
      },
    ]);

    const map = buildPreMigrationRelationshipChangesMap([migration]);

    expect(map.size).toBe(1);
    const orderChanges = map.get("Order");
    expect(orderChanges).toBeDefined();
    expect(orderChanges?.size).toBe(1);
    expect(orderChanges?.get("user")?.kind).toBe("relationship_removed");
  });

  it("ignores other change kinds and entries missing a relationshipName", () => {
    const migration = makeMigration([
      {
        kind: "field_removed",
        typeName: "Order",
        fieldName: "userId",
        before: { type: "uuid", required: true },
      },
      {
        kind: "relationship_modified",
        typeName: "Order",
        relationshipName: "stillThere",
        relationshipType: "forward",
        reason: "targetField changed",
        before: {
          targetType: "User",
          targetField: "userId",
          sourceField: "userId",
          isArray: false,
          description: "",
        },
        after: {
          targetType: "User",
          targetField: "userId",
          sourceField: "userId",
          isArray: true,
          description: "",
        },
      },
    ]);

    const map = buildPreMigrationRelationshipChangesMap([migration]);
    expect(map.size).toBe(0);
  });
});

describe("applyPreMigrationRelationshipAdjustments", () => {
  it("restores a forward relationship using sourceField as the proto refField", () => {
    const relationships: Record<
      string,
      { refType: string; refField: string; srcField: string; array: boolean; description: string }
    > = {};
    const typeChanges = new Map<string, DiffChange>([
      [
        "user",
        {
          kind: "relationship_removed",
          typeName: "Order",
          relationshipName: "user",
          relationshipType: "forward",
          before: {
            targetType: "User",
            targetField: "userId",
            sourceField: "userId",
            isArray: false,
            description: "ref to user",
          },
        },
      ],
    ]);

    applyPreMigrationRelationshipAdjustments(relationships, typeChanges);

    expect(relationships.user).toEqual({
      refType: "User",
      refField: "userId",
      srcField: "userId",
      array: false,
      description: "ref to user",
    });
  });

  it("restores a backward relationship using targetField as the proto refField", () => {
    const relationships: Record<
      string,
      { refType: string; refField: string; srcField: string; array: boolean; description: string }
    > = {};
    const typeChanges = new Map<string, DiffChange>([
      [
        "orders",
        {
          kind: "relationship_removed",
          typeName: "User",
          relationshipName: "orders",
          relationshipType: "backward",
          before: {
            targetType: "Order",
            targetField: "userId",
            sourceField: "id",
            isArray: true,
            description: "all orders for this user",
          },
        },
      ],
    ]);

    applyPreMigrationRelationshipAdjustments(relationships, typeChanges);

    expect(relationships.orders).toEqual({
      refType: "Order",
      refField: "userId",
      srcField: "id",
      array: true,
      description: "all orders for this user",
    });
  });

  it("skips non-removed change kinds and entries without a before snapshot", () => {
    const relationships: Record<string, unknown> = {};
    const typeChanges = new Map<string, DiffChange>([
      [
        "withoutBefore",
        {
          kind: "relationship_removed",
          typeName: "Order",
          relationshipName: "withoutBefore",
          relationshipType: "forward",
        },
      ],
      [
        "modified",
        {
          kind: "relationship_modified",
          typeName: "Order",
          relationshipName: "modified",
          relationshipType: "forward",
          reason: "targetField changed",
          before: {
            targetType: "User",
            targetField: "userId",
            sourceField: "userId",
            isArray: false,
            description: "",
          },
          after: {
            targetType: "User",
            targetField: "userId",
            sourceField: "userId",
            isArray: true,
            description: "",
          },
        },
      ],
    ]);

    applyPreMigrationRelationshipAdjustments(
      relationships as Parameters<typeof applyPreMigrationRelationshipAdjustments>[0],
      typeChanges,
    );

    expect(relationships).toEqual({});
  });
});
