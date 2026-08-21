import * as fs from "node:fs";
import {
  TailorDBGQLPermission_Action,
  TailorDBGQLPermission_Permit,
  TailorDBType_PermitAction,
  TailorDBType_Permission_Permit,
  type TailorDBType as ProtoTailorDBType,
} from "@tailor-platform/tailor-proto/tailordb_resource_pb";
import * as path from "pathe";
import { describe, expect, test, aroundAll, vi } from "vitest";
import { buildTypeScripts } from "#/parser/service/tailordb/type-script";
import {
  loadSnapshot,
  compareRemoteWithSnapshot,
  createSnapshotFromRemoteTypes,
  formatSchemaDrifts,
  SCHEMA_SNAPSHOT_VERSION,
  SCHEMA_FILE_NAME,
  type RemoteGqlPermission,
  type SchemaSnapshot,
} from "./snapshot";

const TEST_MIGRATIONS_BASE = path.join(
  __dirname,
  "__test_migrations__",
  path.basename(import.meta.filename),
);

describe("snapshot", () => {
  const namespace = "tailordb";

  aroundAll(async (runSuite) => {
    await runSuite();
    try {
      fs.rmSync(TEST_MIGRATIONS_BASE, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ==========================================================================
  // compareRemoteWithSnapshot
  // ==========================================================================
  describe("compareRemoteWithSnapshot", () => {
    type MockRemoteFieldConfig = {
      type: string;
      required: boolean;
      array?: boolean;
      unique?: boolean;
      foreignKey?: boolean;
      foreignKeyType?: string;
      foreignKeyField?: string;
      index?: boolean;
      allowedValues?: { value: string }[];
      description?: string;
      scale?: number;
      validate?: unknown[];
      hooks?: {
        create?: { expr: string };
        update?: { expr: string };
      };
      serial?: {
        start: number;
        maxValue?: number;
        format?: string;
      };
      fields?: Record<string, MockRemoteFieldConfig>;
    };

    function createMockRemoteFieldConfigs(
      fields: Record<string, MockRemoteFieldConfig>,
    ): Record<string, unknown> {
      const fieldConfigs: Record<string, unknown> = {};
      for (const [fieldName, config] of Object.entries(fields)) {
        fieldConfigs[fieldName] = {
          type: config.type,
          required: config.required,
          array: config.array ?? false,
          index: config.index ?? false,
          unique: config.unique ?? false,
          foreignKey: config.foreignKey ?? false,
          foreignKeyType: config.foreignKeyType,
          foreignKeyField: config.foreignKeyField,
          description: config.description ?? "",
          allowedValues: config.allowedValues ?? [],
          validate: config.validate ?? [],
          hooks: config.hooks,
          serial: config.serial,
          fields: config.fields ? createMockRemoteFieldConfigs(config.fields) : {},
          ...(config.scale !== undefined && { scale: config.scale }),
        };
      }
      return fieldConfigs;
    }

    /**
     * Create a mock ParsedTailorDBType for testing
     * @param {string} name - Type name
     * @param {Record<string, object>} fields - Field configurations
     * @param {Record<string, unknown>} schema - Additional remote schema properties
     * @returns {ProtoTailorDBType} Mock ParsedTailorDBType
     */
    function createMockRemoteType(
      name: string,
      fields: Record<string, MockRemoteFieldConfig>,
      schema: Record<string, unknown> = {},
    ): ProtoTailorDBType {
      return {
        name,
        schema: {
          ...schema,
          fields: createMockRemoteFieldConfigs(fields),
        },
      } as unknown as ProtoTailorDBType;
    }

    function createMockRemoteGqlPermission(
      tableName: string,
      permit: TailorDBGQLPermission_Permit,
      actions: TailorDBGQLPermission_Action[] = [TailorDBGQLPermission_Action.READ],
    ): RemoteGqlPermission {
      return {
        typeName: tableName,
        permission: {
          id: "task-gql-permission",
          policies: [
            {
              conditions: [],
              actions,
              permit,
              description: "Can read tasks",
            },
          ],
        },
      } as unknown as RemoteGqlPermission;
    }

    test("reconstructs remote tables as normalized schema snapshots", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType("Order", {
            id: { type: "uuid", required: true },
            amount: { type: "decimal", required: true },
          }),
        ],
        namespace,
      );

      expect(snapshot.namespace).toBe(namespace);
      expect(snapshot.tables.Order?.pluralForm).toBe("Orders");
      expect(snapshot.tables.Order?.fields.amount?.scale).toBe(6);
    });

    test("reconstructs remote table-level schema elements", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType(
            "User",
            {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true, index: true },
            },
            {
              description: "Application user",
              settings: {
                pluralForm: "users",
                aggregation: true,
                bulkUpsert: true,
                publishRecordEvents: true,
                disableGqlOperations: { create: true, update: false, delete: false, read: false },
              },
              indexes: {
                email_unique: { fieldNames: ["email"], unique: true },
              },
              files: {
                avatar: { description: "Avatar file" },
              },
              relationships: {
                posts: {
                  refType: "Post",
                  refField: "authorId",
                  srcField: "id",
                  array: true,
                  description: "Posts by user",
                },
              },
              permission: {
                create: [],
                read: [
                  {
                    conditions: [],
                    permit: TailorDBType_Permission_Permit.ALLOW,
                    description: "Can read users",
                  },
                ],
                update: [],
                delete: [],
              },
            },
          ),
        ],
        namespace,
      );

      expect(snapshot.tables.User).toMatchObject({
        description: "Application user",
        settings: {
          aggregation: true,
          bulkUpsert: true,
          publishEvents: true,
          gqlOperations: { create: false },
        },
        indexes: {
          email_unique: { fields: ["email"], unique: true },
        },
        files: {
          avatar: "Avatar file",
        },
        backwardRelationships: {
          posts: {
            targetType: "Post",
            targetField: "authorId",
            sourceField: "id",
            isArray: true,
            description: "Posts by user",
          },
        },
        permissions: {
          record: {
            read: [{ conditions: [], permit: "allow", description: "Can read users" }],
          },
        },
      });
    });

    test("reconstructs remote GQL permissions", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType("Task", {
            id: { type: "uuid", required: true },
            title: { type: "string", required: true },
          }),
        ],
        namespace,
        [createMockRemoteGqlPermission("Task", TailorDBGQLPermission_Permit.ALLOW)],
      );

      expect(snapshot.tables.Task?.permissions?.gql).toEqual([
        {
          conditions: [],
          actions: ["read"],
          permit: "allow",
          description: "Can read tasks",
        },
      ]);
    });

    test("normalizes remote validation expressions back to snapshot form", () => {
      const snapshot = createSnapshotFromRemoteTypes(
        [
          createMockRemoteType("User", {
            email: {
              type: "string",
              required: true,
              validate: [
                {
                  action: TailorDBType_PermitAction.DENY,
                  script: { expr: "!value.includes('@')" },
                  errorMessage: "Email is invalid",
                },
              ],
            },
          }),
        ],
        namespace,
      );

      expect(snapshot.tables.User?.fields.email?.validate).toEqual([
        {
          script: { expr: "value.includes('@')" },
          errorMessage: "Email is invalid",
        },
      ]);
    });

    test("normalizes remote snapshots once at the schema level", () => {
      const remoteTypes = [
        createMockRemoteType("Order", {
          amount: { type: "decimal", required: true },
        }),
      ];

      const entries = Object.entries;
      const normalizedFieldRecords: unknown[] = [];
      const entriesSpy = vi.spyOn(Object, "entries").mockImplementation((value) => {
        const amountField = (value as Record<string, unknown>).amount;
        // The raw remote fields record always sets `array` explicitly (even to
        // false); the converted SnapshotFieldConfig only sets it when true. This
        // isolates the post-conversion fields record from the pre-conversion one.
        if (amountField && typeof amountField === "object" && !("array" in amountField)) {
          normalizedFieldRecords.push(value);
        }
        return entries(value);
      });
      try {
        createSnapshotFromRemoteTypes(remoteTypes, namespace);
      } finally {
        entriesSpy.mockRestore();
      }

      expect(normalizedFieldRecords).toHaveLength(1);
    });

    test("keeps remote type names that match Object prototype keys", () => {
      const remoteTypes = [
        createMockRemoteType("__proto__", {
          id: { type: "uuid", required: true },
        }),
      ];

      const remoteSnapshot = createSnapshotFromRemoteTypes(remoteTypes, namespace);
      expect(Object.hasOwn(remoteSnapshot.tables, "__proto__")).toBe(true);

      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([
        {
          tableName: "__proto__",
          kind: "type_missing_local",
          details: "Table '__proto__' exists in remote but not in snapshot",
        },
      ]);
    });

    test("returns empty array when remote and snapshot match exactly", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: true },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([]);
    });

    test("detects remote drift in table-level schema elements", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true, index: true },
            },
            settings: { aggregation: true },
            indexes: {
              email_unique: { fields: ["email"], unique: true },
            },
            files: {
              avatar: "Avatar file",
            },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Posts by user",
              },
            },
            permissions: {
              record: {
                create: [],
                read: [{ conditions: [], permit: "allow" }],
                update: [],
                delete: [],
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          email: { type: "string", required: true, index: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);

      expect(drifts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tableName: "User", kind: "type_settings_mismatch" }),
          expect.objectContaining({ tableName: "User", kind: "index_missing_remote" }),
          expect.objectContaining({ tableName: "User", kind: "file_missing_remote" }),
          expect.objectContaining({ tableName: "User", kind: "relationship_missing_remote" }),
          expect.objectContaining({ tableName: "User", kind: "permission_mismatch" }),
        ]),
      );
    });

    test("detects mismatched table-level schema element configs", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: true },
            },
            indexes: {
              email_unique: { fields: ["email"], unique: true },
            },
            files: {
              avatar: "Avatar file",
            },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Posts by user",
              },
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
            email: { type: "string", required: true },
          },
          {
            indexes: {
              email_unique: { fieldNames: ["email"], unique: false },
            },
            files: {
              avatar: { description: "Remote avatar file" },
            },
            relationships: {
              posts: {
                refType: "Post",
                refField: "writerId",
                srcField: "id",
                array: true,
                description: "Posts by user",
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tableName: "User", kind: "index_mismatch" }),
          expect.objectContaining({ tableName: "User", kind: "file_mismatch" }),
          expect.objectContaining({ tableName: "User", kind: "relationship_mismatch" }),
        ]),
      );
    });

    test("matches explicit GQL operation enable overrides in remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            settings: { gqlOperations: { create: true } },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            settings: {
              pluralForm: "users",
              disableGqlOperations: {
                create: false,
                update: false,
                delete: false,
                read: false,
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([]);
    });

    test("detects remote relationship description mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            backwardRelationships: {
              posts: {
                targetType: "Post",
                targetField: "authorId",
                sourceField: "id",
                isArray: true,
                description: "Posts by user",
              },
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            relationships: {
              posts: {
                refType: "Post",
                refField: "authorId",
                srcField: "id",
                array: true,
                description: "Published posts by user",
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([
        expect.objectContaining({
          tableName: "User",
          kind: "relationship_mismatch",
          relationshipName: "posts",
          details: expect.stringContaining("description changed"),
        }),
      ]);
    });

    test("treats empty permission blocks as unset during remote comparison", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            permissions: {
              record: {
                create: [],
                read: [],
                update: [],
                delete: [],
              },
              gql: [],
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            permission: {
              create: [],
              read: [],
              update: [],
              delete: [],
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([]);
    });

    test("uses remote GQL permissions when comparing remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              title: { type: "string", required: true },
            },
            permissions: {
              gql: [
                {
                  conditions: [],
                  actions: ["read", "create"],
                  permit: "allow",
                  description: "Can read tasks",
                },
              ],
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType("Task", {
          id: { type: "uuid", required: true },
          title: { type: "string", required: true },
        }),
      ];

      expect(
        compareRemoteWithSnapshot(remoteTypes, snapshot, [
          createMockRemoteGqlPermission("Task", TailorDBGQLPermission_Permit.ALLOW, [
            TailorDBGQLPermission_Action.CREATE,
            TailorDBGQLPermission_Action.READ,
          ]),
        ]),
      ).toEqual([]);

      expect(
        compareRemoteWithSnapshot(remoteTypes, snapshot, [
          createMockRemoteGqlPermission("Task", TailorDBGQLPermission_Permit.DENY),
        ]),
      ).toEqual([expect.objectContaining({ tableName: "Task", kind: "permission_mismatch" })]);
    });

    test("ignores permission policy order when comparing remote snapshots", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: { id: { type: "uuid", required: true } },
            permissions: {
              record: {
                create: [],
                read: [
                  { conditions: [], permit: "allow", description: "everyone" },
                  { conditions: [], permit: "deny", description: "blocked" },
                ],
                update: [],
                delete: [],
              },
              gql: [
                { conditions: [], actions: ["read"], permit: "allow" },
                { conditions: [], actions: ["create"], permit: "deny" },
              ],
            },
          },
        },
      };
      const remoteTypes = [
        {
          name: "Task",
          schema: {
            fields: {
              id: {
                type: "uuid",
                required: true,
                array: false,
                index: false,
                unique: false,
                foreignKey: false,
                allowedValues: [],
                vector: false,
                validate: [],
                fields: {},
              },
            },
            relationships: {},
            indexes: {},
            files: {},
            settings: { pluralForm: "Tasks" },
            permission: {
              create: [],
              read: [
                {
                  conditions: [],
                  permit: TailorDBType_Permission_Permit.DENY,
                  description: "blocked",
                },
                {
                  conditions: [],
                  permit: TailorDBType_Permission_Permit.ALLOW,
                  description: "everyone",
                },
              ],
              update: [],
              delete: [],
            },
          },
        } as unknown as ProtoTailorDBType,
      ];
      const remoteGqlPermissions = [
        {
          typeName: "Task",
          permission: {
            id: "task-gql-permission",
            policies: [
              {
                conditions: [],
                actions: [TailorDBGQLPermission_Action.CREATE],
                permit: TailorDBGQLPermission_Permit.DENY,
                description: "",
              },
              {
                conditions: [],
                actions: [TailorDBGQLPermission_Action.READ],
                permit: TailorDBGQLPermission_Permit.ALLOW,
                description: "",
              },
            ],
          },
        } as unknown as RemoteGqlPermission,
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot, remoteGqlPermissions)).toEqual([]);
    });

    test("does not report drift for one-to-one backward relationships", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
            backwardRelationships: {
              profile: {
                targetType: "Profile",
                targetField: "userId",
                sourceField: "id",
                isArray: false,
                description: "",
              },
            },
          },
        },
      };
      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
          },
          {
            relationships: {
              profile: {
                refType: "Profile",
                refField: "userId",
                srcField: "id",
                array: false,
                description: "",
              },
            },
          },
        ),
      ];

      expect(compareRemoteWithSnapshot(remoteTypes, snapshot)).toEqual([]);
    });

    test("detects type missing in remote", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
          Post: {
            name: "Post",
            pluralForm: "Posts",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_remote");
      expect(drifts[0]!.tableName).toBe("Post");
    });

    test("detects type missing in snapshot (unexpected type in remote)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
        createMockRemoteType("ExtraType", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_local");
      expect(drifts[0]!.tableName).toBe("ExtraType");
    });

    test("detects field missing in remote", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              email: { type: "string", required: false },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_missing_remote");
      expect(drifts[0]!.fieldName).toBe("email");
    });

    test("detects field missing in snapshot (unexpected field in remote)", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          extraField: { type: "string", required: false },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_missing_local");
      expect(drifts[0]!.fieldName).toBe("extraField");
    });

    test("detects field type mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              age: { type: "number", required: false },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          age: { type: "string", required: false },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.fieldName).toBe("age");
      expect(drifts[0]!.details).toContain("type");
    });

    test("detects required flag mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: false },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("required");
    });

    test("detects array flag mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              tags: { type: "string", required: false, array: true },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          tags: { type: "string", required: false, array: false },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("array");
    });

    test("detects enum allowedValues mismatch", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          Task: {
            name: "Task",
            pluralForm: "Tasks",
            fields: {
              id: { type: "uuid", required: true },
              status: {
                type: "enum",
                required: true,
                allowedValues: [{ value: "PENDING" }, { value: "DONE" }],
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("Task", {
          id: { type: "uuid", required: true },
          status: {
            type: "enum",
            required: true,
            allowedValues: [{ value: "PENDING" }, { value: "IN_PROGRESS" }],
          },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("allowedValues");
    });

    test("reports detailed drift for serial and nested fields", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              metadata: {
                type: "nested",
                required: false,
                serial: { start: 10, maxValue: 99, format: "S-%02d" },
                fields: {
                  child: { type: "string", required: false },
                },
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          metadata: {
            type: "nested",
            required: false,
            serial: { start: 1, maxValue: 9, format: "R-%02d" },
            fields: {
              child: { type: "number", required: false },
            },
          },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toHaveLength(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("serial.start");
      expect(drifts[0]!.details).toContain("fields.child.type");
    });

    test("normalizes decimal scale at compare entry so missing scale matches remote default", () => {
      // The snapshot is written from disk without an explicit scale (legacy /
      // user-authored form). compareRemoteWithSnapshot normalizes the snapshot
      // at entry so it becomes equivalent to a remote that has materialized
      // the platform-default scale of 6.
      const testDir = path.join(
        TEST_MIGRATIONS_BASE,
        `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      const snapshotPath = path.join(testDir, "decimal-default", SCHEMA_FILE_NAME);
      fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
      fs.writeFileSync(
        snapshotPath,
        JSON.stringify({
          version: SCHEMA_SNAPSHOT_VERSION,
          namespace,
          createdAt: new Date().toISOString(),
          types: {
            Order: {
              name: "Order",
              pluralForm: "Orders",
              fields: {
                id: { type: "uuid", required: true },
                amount: { type: "decimal", required: true },
              },
            },
          },
        }),
      );
      const snapshot = loadSnapshot(snapshotPath);

      const remoteTypes = [
        createMockRemoteType("Order", {
          id: { type: "uuid", required: true },
          amount: { type: "decimal", required: true, scale: 6 },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts).toEqual([]);
    });

    test("detects drift when decimal scale differs from snapshot", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          Order: {
            name: "Order",
            pluralForm: "Orders",
            fields: {
              id: { type: "uuid", required: true },
              amount: { type: "decimal", required: true, scale: 6 },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("Order", {
          id: { type: "uuid", required: true },
          amount: { type: "decimal", required: true, scale: 2 },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("field_mismatch");
      expect(drifts[0]!.details).toContain("scale: remote=2, expected=6");
    });

    test("handles empty remote tables list", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true } },
          },
        },
      };

      const drifts = compareRemoteWithSnapshot([], snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_remote");
    });

    test("handles empty snapshot tables", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {},
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.length).toBe(1);
      expect(drifts[0]!.kind).toBe("type_missing_local");
    });

    test("detects script_mismatch when remote has no hash", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: {
                type: "string",
                required: true,
                hooks: { create: { expr: "_value.trim()" } },
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
            name: { type: "string", required: true },
          },
          {
            typeHook: {
              create: { expr: '((_invoker) => { return { "name": _value.trim() }; })()' },
            },
          },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(true);
    });

    test("detects script_mismatch when hashes differ", () => {
      const snapshotFields = {
        name: {
          type: "string",
          required: true,
          hooks: { create: { expr: "_value.trim()" } },
        },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true }, ...snapshotFields },
          },
        },
      };

      const differentFields = {
        name: {
          type: "string",
          required: true as const,
          hooks: { create: { expr: "_value.toLowerCase()" } },
        },
      };
      const { typeHook } = buildTypeScripts(differentFields);

      const remoteTypes = [
        createMockRemoteType(
          "User",
          { id: { type: "uuid", required: true }, name: { type: "string", required: true } },
          { typeHook },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(true);
    });

    test("reports a conflicting-hash detail (not a missing-hash one) when remote script expressions disagree", () => {
      const snapshotFields = {
        name: {
          type: "string",
          required: true,
          hooks: { create: { expr: "_value.trim()" } },
        },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true }, ...snapshotFields },
          },
        },
      };

      // Two independent buildTypeScripts calls embed two different hashes;
      // mixing their typeHook and typeValidate outputs simulates a remote
      // type whose script expressions disagree on the hash (e.g. from a
      // partial out-of-band edit), rather than one with no hash at all.
      const { typeHook } = buildTypeScripts(snapshotFields);
      const { typeValidate } = buildTypeScripts(snapshotFields, { typeValidateExpr: "true" });

      const remoteTypes = [
        createMockRemoteType(
          "User",
          { id: { type: "uuid", required: true }, name: { type: "string", required: true } },
          { typeHook, typeValidate },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      const scriptDrift = drifts.find((d) => d.kind === "script_mismatch");
      expect(scriptDrift?.details).toContain("has conflicting script hashes on remote");
      expect(scriptDrift?.details).not.toContain("has no script hash on remote");
    });

    test("reports a distinct detail (not the missing-hash one) when remote has no scripts at all", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: {
                type: "string",
                required: true,
                hooks: { create: { expr: "_value.trim()" } },
              },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      const scriptDrift = drifts.find((d) => d.kind === "script_mismatch");
      expect(scriptDrift?.details).toContain("has scripts in snapshot but not on remote");
      expect(scriptDrift?.details).not.toContain("has no script hash on remote");
    });

    test("no script drift when hashes match", () => {
      const snapshotFields = {
        name: {
          type: "string",
          required: true,
          hooks: { create: { expr: "_value.trim()" } },
        },
      };
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: { id: { type: "uuid", required: true }, ...snapshotFields },
          },
        },
      };

      const { typeHook } = buildTypeScripts(snapshotFields);

      const remoteTypes = [
        createMockRemoteType(
          "User",
          { id: { type: "uuid", required: true }, name: { type: "string", required: true } },
          { typeHook },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(false);
    });

    test("detects script drift when remote has scripts but snapshot does not", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: true },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType(
          "User",
          {
            id: { type: "uuid", required: true },
            name: { type: "string", required: true },
          },
          {
            typeHook: {
              create: { expr: "someExpr() // @sdk-source-hash:abcdef0123456789" },
            },
          },
        ),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(true);
    });

    test("no script drift when neither side has scripts", () => {
      const snapshot: SchemaSnapshot = {
        version: SCHEMA_SNAPSHOT_VERSION,
        namespace,
        createdAt: new Date().toISOString(),
        tables: {
          User: {
            name: "User",
            pluralForm: "Users",
            fields: {
              id: { type: "uuid", required: true },
              name: { type: "string", required: true },
            },
          },
        },
      };

      const remoteTypes = [
        createMockRemoteType("User", {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
        }),
      ];

      const drifts = compareRemoteWithSnapshot(remoteTypes, snapshot);
      expect(drifts.some((d) => d.kind === "script_mismatch")).toBe(false);
    });
  });

  // ==========================================================================
  // formatSchemaDrifts
  // ==========================================================================
  describe("formatSchemaDrifts", () => {
    test("returns 'No schema drifts detected.' for empty array", () => {
      const result = formatSchemaDrifts([]);
      expect(result).toBe("No schema drifts detected.");
    });

    test("formats drifts grouped by table", () => {
      const drifts = [
        {
          tableName: "User",
          kind: "field_missing_remote" as const,
          fieldName: "email",
          details: "Field 'email' exists in snapshot but not in remote",
        },
        {
          tableName: "User",
          kind: "field_mismatch" as const,
          fieldName: "name",
          details: "type: remote=string, expected=text",
        },
        {
          tableName: "Post",
          kind: "type_missing_remote" as const,
          details: "Table 'Post' exists in snapshot but not in remote",
        },
      ];

      const result = formatSchemaDrifts(drifts);
      expect(result).toContain("Table 'User':");
      expect(result).toContain("Field 'email'");
      expect(result).toContain("Field 'name'");
      expect(result).toContain("Table 'Post':");
    });
  });
});
