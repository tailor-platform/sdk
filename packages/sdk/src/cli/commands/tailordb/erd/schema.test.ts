import * as fs from "node:fs";
import * as os from "node:os";
import { create } from "@bufbuild/protobuf";
import {
  TailorDBTypeSchema,
  TailorDBType_FieldConfigSchema,
} from "@tailor-proto/tailor/v1/tailordb_resource_pb";
import * as path from "pathe";
import { describe, expect, test, beforeEach, afterEach, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { writeTblsSchemaToFile, buildTblsSchema, toTblsColumn } from "./schema";
import type {
  TailorDBType as TailorDBProtoType,
  TailorDBType_FieldConfig,
} from "@tailor-proto/tailor/v1/tailordb_resource_pb";

// Type for field config input in tests (without Protobuf internals)
type TestFieldConfig = Partial<{
  type: string;
  description: string;
  required: boolean;
  array: boolean;
  foreignKey: boolean;
  foreignKeyType: string;
  foreignKeyField: string;
  allowedValues: { value: string }[];
}>;

// Helper to create a mock TailorDBType_FieldConfig for testing
function createFieldConfig(config: TestFieldConfig = {}): TailorDBType_FieldConfig {
  return create(TailorDBType_FieldConfigSchema, {
    type: config.type ?? "string",
    description: config.description ?? "",
    required: config.required ?? false,
    array: config.array ?? false,
    foreignKey: config.foreignKey ?? false,
    foreignKeyType: config.foreignKeyType,
    foreignKeyField: config.foreignKeyField,
    allowedValues: config.allowedValues ?? [],
    validate: [],
    fields: {},
    index: false,
    unique: false,
    vector: false,
  });
}

describe("writeTblsSchemaToFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "erd-schema-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("maps TailorDB fields into tbls columns", async () => {
    const client = {
      listTailorDBTypes: vi.fn<MockProcedure>().mockResolvedValue({
        tailordbTypes: [
          {
            name: "User",
            schema: {
              fields: {
                tags: {
                  type: "string",
                  array: true,
                  required: true,
                  description: "Tags",
                  allowedValues: [],
                  foreignKey: false,
                },
              },
            },
          },
        ],
        nextPageToken: "",
      }),
    };

    const outputPath = path.join(tempDir, "schema.json");

    await writeTblsSchemaToFile({
      client: client as never,
      workspaceId: "workspace-id",
      namespace: "ns",
      outputPath,
    });

    const json = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
      tables: Array<{
        columns: Array<{ name: string; type: string; nullable: boolean; comment: string }>;
      }>;
    };

    const columns = json.tables[0]?.columns ?? [];
    const tags = columns.find((column) => column.name === "tags");

    expect(tags).toEqual({
      name: "tags",
      type: "string[]",
      nullable: false,
      comment: "Tags",
    });
  });
});

// Helper to create a minimal TailorDBProtoType
function createType(
  name: string,
  fields: Record<string, TestFieldConfig> = {},
  description = "",
): TailorDBProtoType {
  const fieldConfigs: Record<string, TailorDBType_FieldConfig> = {};

  for (const [fieldName, config] of Object.entries(fields)) {
    fieldConfigs[fieldName] = createFieldConfig(config);
  }

  return create(TailorDBTypeSchema, {
    name,
    schema: {
      description,
      fields: fieldConfigs,
    },
  });
}

describe("toTblsColumn", () => {
  test("should convert basic string field", () => {
    const fieldConfig = createFieldConfig({
      type: "string",
      description: "User name",
      required: true,
    });

    const result = toTblsColumn("name", fieldConfig);

    expect(result).toEqual({
      name: "name",
      type: "string",
      nullable: false,
      comment: "User name",
    });
  });

  test("should set nullable true when required is false", () => {
    const fieldConfig = createFieldConfig({
      type: "int",
      required: false,
    });

    const result = toTblsColumn("age", fieldConfig);

    expect(result.nullable).toBe(true);
  });

  test("should append [] suffix for array fields", () => {
    const fieldConfig = createFieldConfig({
      type: "string",
      array: true,
    });

    const result = toTblsColumn("tags", fieldConfig);

    expect(result.type).toBe("string[]");
  });

  test("should handle empty description", () => {
    const fieldConfig = createFieldConfig({
      type: "uuid",
      required: true,
    });

    const result = toTblsColumn("refId", fieldConfig);

    expect(result.comment).toBe("");
  });
});

describe("buildTblsSchema", () => {
  describe("basic table structure", () => {
    test("should return empty schema for empty types array", () => {
      const result = buildTblsSchema([], "test-namespace");

      expect(result).toEqual({
        name: "test-namespace",
        tables: [],
        relations: [],
        enums: [],
      });
    });

    test("should set namespace as schema name", () => {
      const result = buildTblsSchema([], "my-namespace");

      expect(result.name).toBe("my-namespace");
    });

    test("should create table with correct structure", () => {
      const types = [createType("User")];

      const result = buildTblsSchema(types, "ns");

      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].name).toBe("User");
      expect(result.tables[0].type).toBe("table");
      expect(result.tables[0].indexes).toEqual([]);
      expect(result.tables[0].triggers).toEqual([]);
      expect(result.tables[0].def).toBe("");
    });

    test("should set table comment from schema description", () => {
      const types = [createType("User", {}, "User table description")];

      const result = buildTblsSchema(types, "ns");

      expect(result.tables[0].comment).toBe("User table description");
    });
  });

  describe("implicit id column", () => {
    test("should add implicit id column as first column", () => {
      const types = [createType("User", { name: { type: "string" } })];

      const result = buildTblsSchema(types, "ns");

      expect(result.tables[0].columns[0]).toEqual({
        name: "id",
        type: "uuid",
        nullable: false,
        comment: "",
      });
    });

    test("should add PRIMARY KEY constraint for id column", () => {
      const types = [createType("User")];

      const result = buildTblsSchema(types, "ns");

      const pkConstraint = result.tables[0].constraints.find((c) => c.type === "PRIMARY KEY");

      expect(pkConstraint).toEqual({
        name: "pk_User",
        type: "PRIMARY KEY",
        def: "",
        table: "User",
        columns: ["id"],
      });
    });
  });

  describe("field to column conversion", () => {
    test("should convert fields to columns after id column", () => {
      const types = [
        createType("User", {
          name: { type: "string", required: true, description: "User name" },
          age: { type: "int", required: false },
        }),
      ];

      const result = buildTblsSchema(types, "ns");
      const columns = result.tables[0].columns;

      expect(columns).toHaveLength(3); // id + name + age
      expect(columns[1]).toEqual({
        name: "name",
        type: "string",
        nullable: false,
        comment: "User name",
      });
      expect(columns[2]).toEqual({
        name: "age",
        type: "int",
        nullable: true,
        comment: "",
      });
    });
  });

  describe("foreign key handling", () => {
    test("should create relation for foreign key field", () => {
      const types = [
        createType("Order", {
          customerId: {
            type: "uuid",
            required: true,
            foreignKey: true,
            foreignKeyType: "Customer",
          },
        }),
        createType("Customer"),
      ];

      const result = buildTblsSchema(types, "ns");

      expect(result.relations).toHaveLength(1);
      expect(result.relations[0]).toMatchObject({
        table: "Order",
        columns: ["customerId"],
        parent_table: "Customer",
        parent_columns: ["id"],
        def: "",
      });
    });

    test("should use foreignKeyField when specified", () => {
      const types = [
        createType("Order", {
          customerCode: {
            type: "string",
            foreignKey: true,
            foreignKeyType: "Customer",
            foreignKeyField: "code",
          },
        }),
      ];

      const result = buildTblsSchema(types, "ns");

      expect(result.relations[0].parent_columns).toEqual(["code"]);
    });

    test("should set cardinality to exactly_one for required FK", () => {
      const types = [
        createType("Order", {
          customerId: {
            type: "uuid",
            required: true,
            foreignKey: true,
            foreignKeyType: "Customer",
          },
        }),
      ];

      const result = buildTblsSchema(types, "ns");

      expect(result.relations[0].cardinality).toBe("exactly_one");
      expect(result.relations[0].parent_cardinality).toBe("zero_or_more");
    });

    test("should set cardinality to zero_or_one for optional FK", () => {
      const types = [
        createType("Order", {
          customerId: {
            type: "uuid",
            required: false,
            foreignKey: true,
            foreignKeyType: "Customer",
          },
        }),
      ];

      const result = buildTblsSchema(types, "ns");

      expect(result.relations[0].cardinality).toBe("zero_or_one");
    });

    test("should create FOREIGN KEY constraint", () => {
      const types = [
        createType("Order", {
          customerId: {
            type: "uuid",
            foreignKey: true,
            foreignKeyType: "Customer",
          },
        }),
      ];

      const result = buildTblsSchema(types, "ns");

      const fkConstraint = result.tables[0].constraints.find((c) => c.type === "FOREIGN KEY");

      expect(fkConstraint).toEqual({
        name: "fk_Order_customerId",
        type: "FOREIGN KEY",
        def: "",
        table: "Order",
        columns: ["customerId"],
        referenced_table: "Customer",
        referenced_columns: ["id"],
      });
    });

    test("should populate referenced_tables", () => {
      const types = [
        createType("Order", {
          customerId: {
            type: "uuid",
            foreignKey: true,
            foreignKeyType: "Customer",
          },
          supplierId: {
            type: "uuid",
            foreignKey: true,
            foreignKeyType: "Supplier",
          },
        }),
        createType("Customer"),
        createType("Supplier"),
      ];

      const result = buildTblsSchema(types, "ns");

      const orderTable = result.tables.find((t) => t.name === "Order");
      expect(orderTable?.referenced_tables).toContain("Customer");
      expect(orderTable?.referenced_tables).toContain("Supplier");
    });

    test("should set empty referenced_tables for tables without FK", () => {
      const types = [createType("User", { name: { type: "string" } })];

      const result = buildTblsSchema(types, "ns");

      expect(result.tables[0].referenced_tables).toEqual([]);
    });
  });

  describe("enum handling", () => {
    test("should collect enum values", () => {
      const types = [
        createType("User", {
          status: {
            type: "enum",
            allowedValues: [{ value: "active" }, { value: "inactive" }, { value: "pending" }] as {
              value: string;
            }[],
          },
        }),
      ];

      const result = buildTblsSchema(types, "ns");

      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe("User_status");
      expect(result.enums[0].values).toEqual(["active", "inactive", "pending"]);
    });

    test("should not create enum for empty allowedValues", () => {
      const types = [
        createType("User", {
          status: {
            type: "enum",
            allowedValues: [],
          },
        }),
      ];

      const result = buildTblsSchema(types, "ns");

      expect(result.enums).toHaveLength(0);
    });

    test("should handle multiple enums from different tables", () => {
      const types = [
        createType("User", {
          role: {
            type: "enum",
            allowedValues: [{ value: "admin" }, { value: "user" }] as { value: string }[],
          },
        }),
        createType("Order", {
          status: {
            type: "enum",
            allowedValues: [{ value: "pending" }, { value: "shipped" }] as { value: string }[],
          },
        }),
      ];

      const result = buildTblsSchema(types, "ns");

      expect(result.enums).toHaveLength(2);
      expect(result.enums.map((e) => e.name)).toContain("User_role");
      expect(result.enums.map((e) => e.name)).toContain("Order_status");
    });
  });

  describe("integration", () => {
    test("should handle complex schema with multiple tables and relations", () => {
      const types = [
        createType(
          "Customer",
          {
            name: { type: "string", required: true, description: "Customer name" },
            email: { type: "string", required: true },
            status: {
              type: "enum",
              allowedValues: [{ value: "active" }, { value: "inactive" }] as { value: string }[],
            },
          },
          "Customer entity",
        ),
        createType("Order", {
          customerId: {
            type: "uuid",
            required: true,
            foreignKey: true,
            foreignKeyType: "Customer",
          },
          total: { type: "float", required: true },
          items: { type: "string", array: true },
        }),
        createType("OrderItem", {
          orderId: {
            type: "uuid",
            required: true,
            foreignKey: true,
            foreignKeyType: "Order",
          },
          productName: { type: "string", required: true },
          quantity: { type: "int", required: true },
        }),
      ];

      const result = buildTblsSchema(types, "ecommerce");

      // Schema name
      expect(result.name).toBe("ecommerce");

      // Tables
      expect(result.tables).toHaveLength(3);
      expect(result.tables.map((t) => t.name)).toEqual(["Customer", "Order", "OrderItem"]);

      // Relations
      expect(result.relations).toHaveLength(2);

      // Enums
      expect(result.enums).toHaveLength(1);
      expect(result.enums[0].name).toBe("Customer_status");

      // Customer table structure
      const customerTable = result.tables.find((t) => t.name === "Customer")!;
      expect(customerTable.comment).toBe("Customer entity");
      expect(customerTable.columns.map((c) => c.name)).toEqual(["id", "name", "email", "status"]);
      expect(customerTable.referenced_tables).toEqual([]);

      // Order table referenced_tables
      const orderTable = result.tables.find((t) => t.name === "Order")!;
      expect(orderTable.referenced_tables).toContain("Customer");

      // OrderItem table referenced_tables
      const orderItemTable = result.tables.find((t) => t.name === "OrderItem")!;
      expect(orderItemTable.referenced_tables).toContain("Order");

      // Array field type
      const itemsColumn = orderTable.columns.find((c) => c.name === "items");
      expect(itemsColumn?.type).toBe("string[]");
    });
  });
});
