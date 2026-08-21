import { describe, expect, expectTypeOf, test } from "vitest";
import {
  createSnapshotFromLocalTypes,
  normalizeSchemaSnapshot,
  SCHEMA_SNAPSHOT_VERSION,
  type NormalizedSchemaSnapshot,
  type SchemaSnapshot,
} from "./snapshot";
import { createMockType } from "./test-helpers/snapshot-test";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { TailorDBDeployInput } from "./schema-checks";

describe("snapshot", () => {
  const namespace = "tailordb";

  // ==========================================================================
  // createSnapshotFromLocalTypes
  // ==========================================================================
  describe("createSnapshotFromLocalTypes", () => {
    test("creates snapshot with correct structure", () => {
      const mockTypes: Record<string, TailorDBType> = {
        User: createMockType("User", {
          id: { name: "id", config: { type: "uuid", required: true } },
          name: { name: "name", config: { type: "string", required: true } },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(snapshot.namespace).toBe(namespace);
      expect(snapshot.createdAt).toBeDefined();
      expect(snapshot.tables.User).toBeDefined();
      expect(snapshot.tables.User!.name).toBe("User");
      expect(snapshot.tables.User!.fields.id).toBeDefined();
      expect(snapshot.tables.User!.fields.name).toBeDefined();
    });

    test("captures field attributes", () => {
      const mockTypes: Record<string, TailorDBType> = {
        Product: createMockType("Product", {
          id: { name: "id", config: { type: "uuid", required: true } },
          sku: {
            name: "sku",
            config: { type: "string", required: true, unique: true },
          },
          tags: {
            name: "tags",
            config: { type: "string", required: false, array: true },
          },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.tables.Product!.fields.sku!.required).toBe(true);
      expect(snapshot.tables.Product!.fields.sku!.unique).toBe(true);
      expect(snapshot.tables.Product!.fields.tags!.array).toBe(true);
    });

    test("captures foreign key relationships", () => {
      const mockTypes: Record<string, TailorDBType> = {
        Order: createMockType("Order", {
          id: { name: "id", config: { type: "uuid", required: true } },
          customerId: {
            name: "customerId",
            config: {
              type: "uuid",
              required: true,
              foreignKey: true,
              foreignKeyType: "Customer",
              foreignKeyField: "id",
            },
          },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.tables.Order!.fields.customerId!.foreignKey).toBe(true);
      expect(snapshot.tables.Order!.fields.customerId!.foreignKeyType).toBe("Customer");
      expect(snapshot.tables.Order!.fields.customerId!.foreignKeyField).toBe("id");
    });

    test("preserves a nested field named __proto__", () => {
      const user = createMockType("User", {
        id: { name: "id", config: { type: "uuid", required: true } },
        profile: {
          name: "profile",
          config: {
            type: "nested",
            required: true,
            fields: Object.fromEntries([["__proto__", { type: "string", required: false }]]),
          },
        },
      });

      const snapshot = createSnapshotFromLocalTypes({ User: user }, namespace);
      const fields = snapshot.tables.User!.fields.profile!.fields ?? {};

      expect(Object.hasOwn(fields, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
      expect(fields["__proto__"]?.type).toBe("string");
    });

    test("preserves an index named __proto__", () => {
      const user = createMockType("User", {
        id: { name: "id", config: { type: "uuid", required: true } },
        name: { name: "name", config: { type: "string", required: true } },
      });
      user.indexes = Object.fromEntries([["__proto__", { fields: ["name"], unique: true }]]);

      const snapshot = createSnapshotFromLocalTypes({ User: user }, namespace);
      const indexes = snapshot.tables.User!.indexes ?? {};

      expect(Object.hasOwn(indexes, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(indexes)).toBeNull();
      expect(indexes["__proto__"]).toEqual({ fields: ["name"], unique: true });
    });

    test("preserves a forward relationship named __proto__", () => {
      const post = createMockType("Post", {
        id: { name: "id", config: { type: "uuid", required: true } },
        authorId: { name: "authorId", config: { type: "uuid", required: true } },
      });
      post.forwardRelationships = Object.fromEntries([
        [
          "__proto__",
          {
            name: "__proto__",
            targetType: "User",
            targetField: "authorId",
            sourceField: "id",
            isArray: false,
            description: "Post author",
          },
        ],
      ]);

      const snapshot = createSnapshotFromLocalTypes({ Post: post }, namespace);
      const relationships = snapshot.tables.Post!.forwardRelationships ?? {};

      expect(Object.hasOwn(relationships, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(relationships)).toBeNull();
      expect(relationships["__proto__"]?.targetType).toBe("User");
    });

    test("preserves a backward relationship named __proto__", () => {
      const user = createMockType("User", {
        id: { name: "id", config: { type: "uuid", required: true } },
      });
      user.backwardRelationships = Object.fromEntries([
        [
          "__proto__",
          {
            name: "__proto__",
            targetType: "Post",
            targetField: "authorId",
            sourceField: "id",
            isArray: true,
            description: "User posts",
          },
        ],
      ]);

      const snapshot = createSnapshotFromLocalTypes({ User: user }, namespace);
      const relationships = snapshot.tables.User!.backwardRelationships ?? {};

      expect(Object.hasOwn(relationships, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(relationships)).toBeNull();
      expect(relationships["__proto__"]?.targetType).toBe("Post");
    });

    test("captures enum fields with allowedValues", () => {
      const mockTypes: Record<string, TailorDBType> = {
        Task: createMockType("Task", {
          id: { name: "id", config: { type: "uuid", required: true } },
          status: {
            name: "status",
            config: {
              type: "enum",
              required: true,
              allowedValues: [{ value: "PENDING" }, { value: "IN_PROGRESS" }, { value: "DONE" }],
            },
          },
        }),
      };

      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.tables.Task!.fields.status!.type).toBe("enum");
      expect(snapshot.tables.Task!.fields.status!.allowedValues).toEqual([
        { value: "PENDING" },
        { value: "IN_PROGRESS" },
        { value: "DONE" },
      ]);
    });

    test("handles empty types object", () => {
      const mockTypes: Record<string, TailorDBType> = {};
      const snapshot = createSnapshotFromLocalTypes(mockTypes, namespace);

      expect(snapshot.version).toBe(SCHEMA_SNAPSHOT_VERSION);
      expect(snapshot.tables).toEqual({});
    });
  });

  describe("normalizeSchemaSnapshot", () => {
    test("normalizes legacy type and nested field defaults in one pass", () => {
      const snapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          Product: {
            name: "Product",
            fields: {
              price: { type: "decimal", required: true },
              metadata: {
                type: "object",
                required: false,
                fields: {
                  discount: { type: "decimal", required: false },
                },
              },
            },
          },
        },
      } as unknown as SchemaSnapshot;

      const normalized = normalizeSchemaSnapshot(snapshot);

      expect(normalized).not.toBe(snapshot);
      expectTypeOf(normalized).toEqualTypeOf<NormalizedSchemaSnapshot>();
      expectTypeOf<NormalizedSchemaSnapshot>().toExtend<SchemaSnapshot>();
      expectTypeOf<SchemaSnapshot>().not.toExtend<NormalizedSchemaSnapshot>();
      // A snapshot keys its tables under `tables`; a deploy input keys its
      // parsed types under `types`. Spreading one over the other type-checks
      // either way, so pin the distinction here.
      expectTypeOf<SchemaSnapshot>().not.toHaveProperty("types");
      expectTypeOf<TailorDBDeployInput>().toHaveProperty("types");
      expectTypeOf<TailorDBDeployInput>().not.toHaveProperty("tables");
      expect(normalized.tables.Product?.pluralForm).toBe("Products");
      expect(normalized.tables.Product?.fields.price?.scale).toBe(6);
      expect(normalized.tables.Product?.fields.metadata?.fields?.discount?.scale).toBe(6);

      // Original snapshot must remain unmutated (the footgun this behavior fixes)
      expect(snapshot.tables.Product?.pluralForm).toBeUndefined();
      expect(snapshot.tables.Product?.fields.price?.scale).toBeUndefined();
      expect(snapshot.tables.Product?.fields.metadata?.fields?.discount?.scale).toBeUndefined();
    });
  });
});
