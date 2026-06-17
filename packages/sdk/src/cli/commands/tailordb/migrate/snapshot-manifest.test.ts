// MessageInitShape makes every proto field optional
/* oxlint-disable typescript/no-unnecessary-condition */
import { describe, expect, test } from "vitest";
import { SCHEMA_SNAPSHOT_VERSION } from "./diff-calculator";
import {
  generateTailorDBTypeManifestFromSnapshot,
  generateAllTypeManifestsFromSnapshot,
  compareSnapshotWithRemote,
} from "./snapshot-manifest";
import type { SchemaSnapshot, TailorDBSnapshotType, SnapshotRecordPermission } from "./snapshot";

describe("snapshot-manifest", () => {
  function createTestSnapshotType(
    name: string,
    overrides: Partial<TailorDBSnapshotType> = {},
  ): TailorDBSnapshotType {
    return {
      name,
      pluralForm: `${name}s`,
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
      ...overrides,
    };
  }

  function createTestSnapshot(
    types: Record<string, TailorDBSnapshotType>,
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
    test("generates basic type manifest with required fields", () => {
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

    test("generates plural form correctly", () => {
      const snapshotType = createTestSnapshotType("User");
      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.settings?.pluralForm).toBe("users");
    });

    test("uses custom plural form when provided", () => {
      const snapshotType = createTestSnapshotType("User", {
        pluralForm: "UserList",
      });
      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.settings?.pluralForm).toBe("userList");
    });

    test("includes description when provided", () => {
      const snapshotType = createTestSnapshotType("User", {
        description: "A user in the system",
      });
      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.description).toBe("A user in the system");
    });

    test.each([
      { publishRecordEvents: true, expected: true },
      { publishRecordEvents: false, expected: false },
    ])(
      "sets publishRecordEvents to $expected from options.publishRecordEvents=$publishRecordEvents",
      ({ publishRecordEvents, expected }) => {
        const snapshotType = createTestSnapshotType("User");

        const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType, {
          publishRecordEvents,
        });

        expect(manifest.schema?.settings?.publishRecordEvents).toBe(expected);
      },
    );

    test.each([
      { publishEvents: true, expected: true },
      { publishEvents: false, expected: false },
    ])(
      "reads publishEvents=$publishEvents from snapshot settings as $expected",
      ({ publishEvents, expected }) => {
        const snapshotType = createTestSnapshotType("User", { settings: { publishEvents } });

        const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

        expect(manifest.schema?.settings?.publishRecordEvents).toBe(expected);
      },
    );

    test("prioritizes snapshot settings.publishEvents over options.publishRecordEvents", () => {
      const snapshotType = createTestSnapshotType("User", {
        settings: { publishEvents: true },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType, {
        publishRecordEvents: false,
      });

      expect(manifest.schema?.settings?.publishRecordEvents).toBe(true);
    });

    test("handles enum fields with allowed values", () => {
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

    test("handles array fields", () => {
      const snapshotType = createTestSnapshotType("User", {
        fields: {
          id: { type: "uuid", required: true },
          tags: { type: "string", required: false, array: true },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);

      expect(manifest.schema?.fields?.tags?.array).toBe(true);
    });

    test("handles foreign key relationships", () => {
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

    test("handles indexes", () => {
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

    test("handles file fields", () => {
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

    test("handles forward relationships", () => {
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

    test("handles backward relationships", () => {
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

    test("handles record permissions", () => {
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

    test("applies gqlOperations from options", () => {
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

    test("aggregates field hooks into a type-level hook script", () => {
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

      // Field-level hooks are no longer emitted per field.
      expect(manifest.schema?.fields?.updatedAt?.hooks).toBeUndefined();

      // They are aggregated into a single type-level script that binds a shared
      // timestamp once and dispatches each field's hook.
      const createHook = manifest.schema?.typeHook?.create?.expr ?? "";
      expect(createHook).toContain("const _now = new Date()");
      expect(createHook).toContain('"updatedAt": ((_value) => (now()))(_input["updatedAt"])');
      expect(manifest.schema?.typeHook?.update?.expr).toContain('_input["updatedAt"]');
      expect(manifest.schema?.typeValidate).toBeUndefined();
    });

    test("aggregates nested field hooks and validators into type-level scripts", () => {
      const snapshotType = createTestSnapshotType("User", {
        fields: {
          id: { type: "uuid", required: true },
          profile: {
            type: "nested",
            required: true,
            fields: {
              displayName: {
                type: "string",
                required: true,
                validate: [
                  {
                    script: { expr: "((_value ?? '').length > 0)" },
                    errorMessage: "Display name is required",
                  },
                ],
                hooks: {
                  create: { expr: "(_value ?? '').trim()" },
                  update: { expr: "(_value ?? '').trim()" },
                },
              },
              contact: {
                type: "nested",
                required: true,
                fields: {
                  email: {
                    type: "string",
                    required: true,
                    validate: [
                      {
                        script: { expr: "((_value ?? '').includes('@'))" },
                        errorMessage: "Email must contain @",
                      },
                    ],
                    hooks: {
                      create: { expr: "(_value ?? '').toLowerCase()" },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);
      const profileField = manifest.schema?.fields?.profile;
      const displayNameField = profileField?.fields?.displayName;
      const emailField = profileField?.fields?.contact?.fields?.email;

      // Nested field hooks/validators are not emitted per field.
      expect(displayNameField?.hooks).toBeUndefined();
      expect(displayNameField?.validate ?? []).toHaveLength(0);
      expect(emailField?.hooks).toBeUndefined();
      expect(emailField?.validate ?? []).toHaveLength(0);

      // Hooks are aggregated into a type-level script that reconstructs nested
      // objects so unhooked siblings are preserved.
      const hookExpr = manifest.schema?.typeHook?.create?.expr ?? "";
      expect(hookExpr).toContain('"profile": Object.assign({}, _input["profile"], {');
      expect(hookExpr).toContain("(_value ?? '').trim()");
      expect(hookExpr).toContain('(_input["profile"] || {})["displayName"]');
      expect(hookExpr).toContain(
        '"contact": Object.assign({}, (_input["profile"] || {})["contact"], {',
      );
      expect(hookExpr).toContain("(_value ?? '').toLowerCase()");

      // Validators are aggregated into a type-level validate script keyed by the
      // dotted field path, with the boolean expression negated into a failure.
      const validateExpr = manifest.schema?.typeValidate?.create?.expr ?? "";
      expect(validateExpr).toContain('__errs["profile.displayName"] = "Display name is required"');
      expect(validateExpr).toContain("if (!(((_value ?? '').length > 0)))");
      expect(validateExpr).toContain('__errs["profile.contact.email"] = "Email must contain @"');
      expect(manifest.schema?.typeValidate?.update?.expr).toBe(validateExpr);
    });

    test("handles serial configuration", () => {
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

    test("converts serial in nested fields to bigint", () => {
      const snapshotType = createTestSnapshotType("Order", {
        fields: {
          id: { type: "uuid", required: true },
          detail: {
            type: "nested",
            required: true,
            fields: {
              lineNumber: {
                type: "string",
                required: true,
                serial: {
                  start: 1000,
                  maxValue: 9999,
                  format: "LINE-%04d",
                },
              },
            },
          },
        },
      });

      const manifest = generateTailorDBTypeManifestFromSnapshot(snapshotType);
      const serial = manifest.schema?.fields?.detail?.fields?.lineNumber?.serial;

      // Nested serial values must be bigint (not number) so that the deploy
      // comparison matches the proto-typed remote schema. A number here would
      // produce a spurious "update" on every deploy.
      expect(serial?.start).toBe(1000n);
      expect(serial?.maxValue).toBe(9999n);
      expect(serial?.format).toBe("LINE-%04d");
    });
  });

  describe("generateAllTypeManifestsFromSnapshot", () => {
    test("generates manifests for all types in snapshot", () => {
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

    test.each([
      {
        name: "applies executorUsedTypes to enable publishRecordEvents",
        types: { User: {}, Post: {} },
        options: { executorUsedTypes: new Set(["User"]) },
        expected: { User: true, Post: false },
      },
      {
        name: "applies manual publishEvents setting from snapshot",
        types: { User: { settings: { publishEvents: true } }, Post: {} },
        options: {},
        expected: { User: true, Post: false },
      },
      {
        name: "respects explicit publishEvents=false when no executor uses the type",
        types: { User: { settings: { publishEvents: false } }, Post: {} },
        options: {},
        expected: { User: false, Post: false },
      },
      {
        name: "combines manual setting and executor usage correctly",
        types: {
          User: { settings: { publishEvents: true } },
          Post: { settings: { publishEvents: false } },
          Comment: {},
        },
        options: { executorUsedTypes: new Set(["Comment"]) },
        expected: { User: true, Post: false, Comment: true },
      },
      {
        name: "falls back to baseOptions.publishRecordEvents when no manual setting and no executor",
        types: { User: {}, Post: {} },
        options: { executorUsedTypes: new Set(["Other"]), publishRecordEvents: true },
        expected: { User: true, Post: true },
      },
    ])("$name", ({ types, options, expected }) => {
      const snapshot = createTestSnapshot(
        Object.fromEntries(
          Object.entries(types).map(([name, overrides]) => [
            name,
            createTestSnapshotType(name, overrides),
          ]),
        ),
      );

      const manifests = generateAllTypeManifestsFromSnapshot(snapshot, options);

      for (const [name, expectedValue] of Object.entries(expected)) {
        expect(manifests.get(name)?.schema?.settings?.publishRecordEvents).toBe(expectedValue);
      }
    });

    test("applies namespace gqlOperations to all types", () => {
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

    test("throws error when executor uses type with publishEvents=false", () => {
      const snapshot = createTestSnapshot({
        User: createTestSnapshotType("User", {
          settings: { publishEvents: false },
        }),
      });

      expect(() =>
        generateAllTypeManifestsFromSnapshot(snapshot, {
          executorUsedTypes: new Set(["User"]),
        }),
      ).toThrow(
        'Type "User" has publishEvents set to false, but it is used by an executor with a record trigger.',
      );
    });

    test("returns empty map for empty snapshot", () => {
      const snapshot = createTestSnapshot({});

      const manifests = generateAllTypeManifestsFromSnapshot(snapshot);

      expect(manifests.size).toBe(0);
    });
  });

  describe("compareSnapshotWithRemote", () => {
    test.each([
      {
        name: "identifies types to create",
        types: ["User", "Post"],
        existing: ["User"],
        creates: ["Post"],
        updates: ["User"],
        deletes: [],
      },
      {
        name: "identifies types to update",
        types: ["User", "Post"],
        existing: ["User", "Post"],
        creates: [],
        updates: ["User", "Post"],
        deletes: [],
      },
      {
        name: "identifies types to delete",
        types: ["User"],
        existing: ["User", "Post", "Comment"],
        creates: [],
        updates: ["User"],
        deletes: ["Post", "Comment"],
      },
      {
        name: "handles empty snapshot",
        types: [],
        existing: ["User", "Post"],
        creates: [],
        updates: [],
        deletes: ["User", "Post"],
      },
      {
        name: "handles empty remote",
        types: ["User", "Post"],
        existing: [],
        creates: ["User", "Post"],
        updates: [],
        deletes: [],
      },
    ])("$name", ({ types, existing, creates, updates, deletes }) => {
      const snapshot = createTestSnapshot(
        Object.fromEntries(types.map((name) => [name, createTestSnapshotType(name)])),
      );
      const existingTypes = new Set(existing);

      const comparison = compareSnapshotWithRemote(snapshot, existingTypes);

      expect(comparison.creates.toSorted()).toEqual([...creates].toSorted());
      expect(comparison.updates.toSorted()).toEqual([...updates].toSorted());
      expect(comparison.deletes.toSorted()).toEqual([...deletes].toSorted());
    });
  });
});
