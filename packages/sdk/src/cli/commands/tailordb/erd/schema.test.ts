import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { buildTailorDbErdSchema, writeTailorDbErdSchemaToFile } from "./schema";
import type { TailorDBNamespaceData } from "@/types/plugin-generation";
import type { OperatorFieldConfig, ParsedField, TailorDBType } from "@/types/tailordb";

function createField(
  name: string,
  config: Partial<OperatorFieldConfig>,
  relation?: ParsedField["relation"],
): ParsedField {
  return {
    name,
    config: {
      type: config.type ?? "string",
      required: config.required,
      description: config.description,
      allowedValues: config.allowedValues,
      array: config.array,
      index: config.index,
      unique: config.unique,
      foreignKey: config.foreignKey,
      foreignKeyType: config.foreignKeyType,
      foreignKeyField: config.foreignKeyField,
      rawRelation: config.rawRelation,
      validate: config.validate,
      hooks: config.hooks,
      serial: config.serial,
      scale: config.scale,
      fields: config.fields,
    },
    relation,
  };
}

function createType(
  name: string,
  fields: Record<string, ParsedField> = {},
  options: Partial<TailorDBType> = {},
): TailorDBType {
  return {
    name,
    pluralForm: options.pluralForm ?? `${name}s`,
    description: options.description,
    fields,
    forwardRelationships: options.forwardRelationships ?? {},
    backwardRelationships: options.backwardRelationships ?? {},
    settings: options.settings ?? {},
    permissions: options.permissions ?? {},
    indexes: options.indexes,
    files: options.files,
  };
}

function createNamespace(types: Record<string, TailorDBType>): TailorDBNamespaceData {
  return {
    namespace: "shop",
    types,
    sourceInfo: new Map(),
    pluginAttachments: new Map(),
  };
}

describe("buildTailorDbErdSchema", () => {
  test("maps TailorDB types into TailorDB ERD schema v1", () => {
    const customer = createType(
      "Customer",
      {
        name: createField("name", {
          type: "string",
          required: true,
          description: "Customer name",
        }),
        status: createField("status", {
          type: "enum",
          required: false,
          allowedValues: [
            { value: "active", description: "Can place orders" },
            { value: "inactive" },
          ],
        }),
        tags: createField("tags", {
          type: "string",
          array: true,
        }),
      },
      {
        description: "Customer records",
        indexes: {
          idx_customer_name: { fields: ["name"] },
        },
      },
    );

    const schema = buildTailorDbErdSchema({
      namespaceData: createNamespace({ Customer: customer }),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(schema).toMatchObject({
      version: 1,
      namespace: "shop",
      source: "local",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(schema.cleanRoom.notes.join(" ")).toContain("does not copy Liam source code");
    expect(schema.tables[0]).toMatchObject({
      name: "Customer",
      pluralForm: "Customers",
      description: "Customer records",
    });
    expect(schema.tables[0].columns).toEqual([
      {
        name: "id",
        type: "uuid",
        required: true,
        array: false,
        primaryKey: true,
        unique: true,
      },
      {
        name: "name",
        type: "string",
        required: true,
        array: false,
        description: "Customer name",
        index: true,
        indexNames: ["idx_customer_name"],
      },
      {
        name: "status",
        type: "enum",
        required: false,
        array: false,
        enumValues: ["active", "inactive"],
        enumValueDescriptions: { active: "Can place orders" },
      },
      {
        name: "tags",
        type: "string",
        required: true,
        array: true,
      },
    ]);
  });

  test("builds relations from parsed TailorDB relation metadata", () => {
    const customer = createType("Customer");
    const order = createType("Order", {
      customerId: createField(
        "customerId",
        {
          type: "uuid",
          required: true,
          foreignKey: true,
          foreignKeyType: "Customer",
          foreignKeyField: "id",
          rawRelation: {
            type: "n-1",
            toward: { type: "Customer", as: "customer", key: "id" },
            backward: "orders",
          },
        },
        {
          targetType: "Customer",
          forwardName: "customer",
          backwardName: "orders",
          key: "id",
          unique: false,
        },
      ),
    });

    const schema = buildTailorDbErdSchema({
      namespaceData: createNamespace({ Customer: customer, Order: order }),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(schema.relations).toEqual([
      {
        name: "Order.customerId->Customer.id",
        sourceTable: "Order",
        sourceColumns: ["customerId"],
        targetTable: "Customer",
        targetColumns: ["id"],
        required: true,
        unique: false,
        kind: "relation",
        relationType: "n-1",
        forwardName: "customer",
        backwardName: "orders",
      },
    ]);
    expect(schema.tables.find((table) => table.name === "Order")?.columns[1].relation).toEqual({
      targetTable: "Customer",
      targetColumn: "id",
      kind: "relation",
      required: true,
      relationType: "n-1",
      forwardName: "customer",
      backwardName: "orders",
    });
  });

  test("does not duplicate the implicit parsed id field", () => {
    const user = createType("User", {
      id: createField("id", {
        type: "uuid",
        required: true,
      }),
      email: createField("email", {
        type: "string",
        required: true,
      }),
    });

    const schema = buildTailorDbErdSchema({
      namespaceData: createNamespace({ User: user }),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(schema.tables[0].columns.map((column) => column.name)).toEqual(["id", "email"]);
    expect(schema.tables[0].columns[0]).toMatchObject({
      name: "id",
      primaryKey: true,
      unique: true,
    });
  });

  test("includes plugin source metadata without local file paths", () => {
    const namespace = createNamespace({
      AuditLog: createType("AuditLog"),
    });
    namespace.sourceInfo = new Map([
      [
        "AuditLog",
        {
          exportName: "AuditLog",
          pluginId: "audit-plugin",
          pluginImportPath: "@example/audit",
          originalFilePath: "/Users/example/project/tailordb/user.ts",
          originalExportName: "User",
          generatedTypeKind: "history",
          namespace: "shop",
        },
      ],
    ]);

    const schema = buildTailorDbErdSchema({
      namespaceData: namespace,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(schema.tables[0].source).toEqual({
      kind: "plugin",
      exportName: "AuditLog",
      pluginId: "audit-plugin",
      pluginImportPath: "@example/audit",
      originalExportName: "User",
      generatedTypeKind: "history",
      namespace: "shop",
    });
    expect(JSON.stringify(schema)).not.toContain("/Users/example");
  });

  test("keeps revisions stable when only generatedAt changes", () => {
    const namespace = createNamespace({ User: createType("User") });

    const first = buildTailorDbErdSchema({
      namespaceData: namespace,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const second = buildTailorDbErdSchema({
      namespaceData: namespace,
      generatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(first.revision).toBe(second.revision);
  });
});

describe("writeTailorDbErdSchemaToFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-erd-schema-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test("writes schema JSON to disk", () => {
    const schema = buildTailorDbErdSchema({
      namespaceData: createNamespace({ User: createType("User") }),
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const outputPath = path.join(tempDir, "schema.json");

    writeTailorDbErdSchemaToFile({ schema, outputPath });

    expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toMatchObject({
      version: 1,
      namespace: "shop",
      tables: [{ name: "User" }],
    });
  });
});
