import { describe, expect, it } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import {
  generateTailorDBTypeManifestFromSnapshot,
  generateAllTypeManifestsFromSnapshot,
  compareSnapshotWithRemote,
} from "./snapshot-manifest";
import type { SchemaSnapshot, SnapshotType, SnapshotRecordPermission } from "./snapshot";

describe("snapshot-manifest", () => {
  function createTestSnapshotType(
    name: string,
    overrides: Partial<SnapshotType> = {},
  ): SnapshotType {
    return {
      name,
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
      ...overrides,
    };
  }

  function createTestSnapshot(
    types: Record<string, SnapshotType>,
    namespace = "tailordb",
  ): SchemaSnapshot {
    return {
      version: SCHEMA_SNAPSHOT_VERSION,
      namespace,
      createdAt: new Date().toISOString(),
      types,
    };
  }

  describe("generateTailorDBTypeManifestFromSnapshot", () => {
    it("generates basic type manifest with required fields", () => {
      const snapshotType = createTestSnapshotType("User", {
        fields: {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
          email: { type: "string", required: false },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.name).toBe("User");
      expect(manifest.schema?.fields).toHaveProperty("name");
      expect(manifest.schema?.fields).toHaveProperty("email");
      expect(manifest.schema?.fields).not.toHaveProperty("id");
      expect(manifest.schema?.fields?.name?.required).toBe(true);
      expect(manifest.schema?.fields?.email?.required).toBe(false);
    });

    it("generates plural form correctly", () => {
      const snapshotType = createTestSnapshotType("User");
      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.settings?.pluralForm).toBe("users");
    });

    it("uses custom plural form when provided", () => {
      const snapshotType = createTestSnapshotType("User", {
        pluralForm: "UserList",
      });
      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.settings?.pluralForm).toBe("userList");
    });

    it("includes description when provided", () => {
      const snapshotType = createTestSnapshotType("User", {
        description: "A user in the system",
      });
      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.description).toBe("A user in the system");
    });

    it("sets publishRecordEvents from options", () => {
      const snapshotType = createTestSnapshotType("User");

      const manifestWithEvents = generateTailorDBTypeManifestFromSnapshot(snapshotType, {
        publishRecordEvents: true,
      });
      const manifestWithoutEvents = generateTailorDBTypeManifestFromSnapshot(snapshotType, {
        publishRecordEvents: false,
      });

      expect(manifestWithEvents.schema?.settings?.publishRecordEvents).toBe(true);
      expect(manifestWithoutEvents.schema?.settings?.publishRecordEvents).toBe(false);
    });

    it("handles enum fields with allowed values", () => {
      const snapshotType = createTestSnapshotType("Task", {
        fields: {
          id: { type: "uuid", required: true },
          status: {
            type: "enum",
            required: true,
            allowedValues: [
              { value: "PENDING", description: "Task is pending" },
              { value: "IN_PROGRESS" },
              { value: "DONE" },
            ],
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.fields?.status?.type).toBe("enum");
      expect(manifest.schema?.fields?.status?.allowedValues).toHaveLength(3);
      expect(manifest.schema?.fields?.status?.allowedValues?.[0]?.value).toBe("PENDING");
    });

    it("handles array fields", () => {
      const snapshotType = createTestSnapshotType("User", {
        fields: {
          id: { type: "uuid", required: true },
          tags: { type: "string", required: false, array: true },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.fields?.tags?.array).toBe(true);
    });

    it("handles foreign key relationships", () => {
      const snapshotType = createTestSnapshotType("Post", {
        fields: {
          id: { type: "uuid", required: true },
          authorId: {
            type: "uuid",
            required: true,
            foreignKey: true,
            foreignKeyType: "User",
            foreignKeyField: "id",
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.fields?.authorId?.foreignKey).toBe(true);
      expect(manifest.schema?.fields?.authorId?.foreignKeyType).toBe("User");
      expect(manifest.schema?.fields?.authorId?.foreignKeyField).toBe("id");
    });

    it("handles indexes", () => {
      const snapshotType = createTestSnapshotType("User", {
        indexes: {
          email_unique: {
            fields: ["email"],
            unique: true,
          },
          name_status: {
            fields: ["name", "status"],
            unique: false,
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.indexes?.email_unique?.fieldNames).toEqual(["email"]);
      expect(manifest.schema?.indexes?.email_unique?.unique).toBe(true);
      expect(manifest.schema?.indexes?.name_status?.fieldNames).toEqual(["name", "status"]);
      expect(manifest.schema?.indexes?.name_status?.unique).toBe(false);
    });

    it("handles file fields", () => {
      const snapshotType = createTestSnapshotType("Document", {
        files: {
          attachment: "Document attachment",
          thumbnail: "",
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.files?.attachment?.description).toBe("Document attachment");
      expect(manifest.schema?.files?.thumbnail?.description).toBe("");
    });

    it("handles forward relationships", () => {
      const snapshotType = createTestSnapshotType("Post", {
        forwardRelationships: {
          author: {
            targetType: "User",
            targetField: "id",
            sourceField: "authorId",
            isArray: false,
            description: "Post author",
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.relationships?.author?.refType).toBe("User");
      expect(manifest.schema?.relationships?.author?.array).toBe(false);
    });

    it("handles backward relationships", () => {
      const snapshotType = createTestSnapshotType("User", {
        backwardRelationships: {
          posts: {
            targetType: "Post",
            targetField: "authorId",
            sourceField: "id",
            isArray: true,
            description: "User posts",
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.relationships?.posts?.refType).toBe("Post");
      expect(manifest.schema?.relationships?.posts?.array).toBe(true);
    });

    it("handles record permissions", () => {
      const permission: SnapshotRecordPermission = {
        create: [
          {
            conditions: [[{ user: "role" }, "eq", "admin"]],
            permit: "allow",
            description: "Only admins can create",
          },
        ],
        read: [],
        update: [],
        delete: [],
      };

      const snapshotType = createTestSnapshotType("User", {
        permissions: { record: permission },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.permission?.create).toHaveLength(1);
    });

    it("applies gqlOperations from options", () => {
      const snapshotType = createTestSnapshotType("User");

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType, {
        namespaceGqlOperations: {
          create: true,
          update: true,
          delete: false,
          read: true,
        },
      });

      expect(manifest.schema?.settings?.disableGqlOperations?.create).toBe(false);
      expect(manifest.schema?.settings?.disableGqlOperations?.delete).toBe(true);
    });

    it("handles hooks configuration", () => {
      const snapshotType = createTestSnapshotType("User", {
        fields: {
          id: { type: "uuid", required: true },
          updatedAt: {
            type: "datetime",
            required: true,
            hooks: {
              create: { expr: "now()" },
              update: { expr: "now()" },
            },
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.fields?.updatedAt?.hooks?.create?.expr).toBe("now()");
      expect(manifest.schema?.fields?.updatedAt?.hooks?.update?.expr).toBe("now()");
    });

    it("handles serial configuration", () => {
      const snapshotType = createTestSnapshotType("Order", {
        fields: {
          id: { type: "uuid", required: true },
          orderNumber: {
            type: "string",
            required: true,
            serial: {
              start: 1000,
              maxValue: 9999,
              format: "ORD-%04d",
            },
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.fields?.orderNumber?.serial?.start).toBe(1000n);
      expect(manifest.schema?.fields?.orderNumber?.serial?.maxValue).toBe(9999n);
      expect(manifest.schema?.fields?.orderNumber?.serial?.format).toBe("ORD-%04d");
    });
  });

  describe("generateAllTypeManifestsFromSnapshot", () => {
    it("generates manifests for all types in snapshot", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User"),
        Post: createTestSnapshotType("Post"),
        Comment: createTestSnapshotType("Comment"),
      });

      const manifests = generateAllTypeManifestsFromSnapshot(snapshot);

      expect(manifests.size).toBe(3);
      expect(manifests.has("User")).toBe(true);
      expect(manifests.has("Post")).toBe(true);
      expect(manifests.has("Comment")).toBe(true);
    });

    it("applies executorUsedTypes to enable publishRecordEvents", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User"),
        Post: createTestSnapshotType("Post"),
      });

      const manifests = generateAllTypeManifestsFromSnapshot(snapshot, {
        executorUsedTypes: new Set(["User"]),
      });

      expect(manifests.get("User")?.schema?.settings?.publishRecordEvents).toBe(true);
      expect(manifests.get("Post")?.schema?.settings?.publishRecordEvents).toBe(false);
    });

    it("returns empty map for empty snapshot", () => {
      const snapshot = createTestSnapshot({});

      const manifests = generateAllTypeManifestsFromSnapshot(snapshot);

      expect(manifests.size).toBe(0);
    });

    it("applies namespace gqlOperations to all types", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User"),
        Post: createTestSnapshotType("Post"),
      });

      const manifests = generateAllTypeManifestsFromSnapshot(snapshot, {
        namespaceGqlOperations: {
          create: false,
          update: true,
          delete: true,
          read: true,
        },
      });

      expect(manifests.get("User")?.schema?.settings?.disableGqlOperations?.create).toBe(true);
      expect(manifests.get("Post")?.schema?.settings?.disableGqlOperations?.create).toBe(true);
    });
  });

  describe("compareSnapshotWithRemote", () => {
    it("identifies types to create", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User"),
        Post: createTestSnapshotType("Post"),
      });

      const existingTypes = new Set(["User"]);

      const comparison = compareSnapshotWithRemote(snapshot, existingTypes);

      expect(comparison.creates).toEqual(["Post"]);
      expect(comparison.updates).toEqual(["User"]);
      expect(comparison.deletes).toEqual([]);
    });

    it("identifies types to update", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User"),
        Post: createTestSnapshotType("Post"),
      });

      const existingTypes = new Set(["User", "Post"]);

      const comparison = compareSnapshotWithRemote(snapshot, existingTypes);

      expect(comparison.creates).toEqual([]);
      expect(comparison.updates).toContain("User");
      expect(comparison.updates).toContain("Post");
      expect(comparison.deletes).toEqual([]);
    });

    it("identifies types to delete", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User"),
      });

      const existingTypes = new Set(["User", "Post", "Comment"]);

      const comparison = compareSnapshotWithRemote(snapshot, existingTypes);

      expect(comparison.creates).toEqual([]);
      expect(comparison.updates).toEqual(["User"]);
      expect(comparison.deletes).toContain("Post");
      expect(comparison.deletes).toContain("Comment");
    });

    it("handles empty snapshot", () => {
      const snapshot = createTestSnapshot({});

      const existingTypes = new Set(["User", "Post"]);

      const comparison = compareSnapshotWithRemote(snapshot, existingTypes);

      expect(comparison.creates).toEqual([]);
      expect(comparison.updates).toEqual([]);
      expect(comparison.deletes).toContain("User");
      expect(comparison.deletes).toContain("Post");
    });

    it("handles empty remote", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User"),
        Post: createTestSnapshotType("Post"),
      });

      const existingTypes = new Set<string>();

      const comparison = compareSnapshotWithRemote(snapshot, existingTypes);

      expect(comparison.creates).toContain("User");
      expect(comparison.creates).toContain("Post");
      expect(comparison.updates).toEqual([]);
      expect(comparison.deletes).toEqual([]);
    });
  });
});
