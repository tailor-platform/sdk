import { describe, expect, it } from "vitest";
import { generateDts } from "./generator";
import type { Manifest } from "@/cli/generator/manifest";

describe("generateDts GraphQL schema", () => {
  it("generates GraphQL module augmentation for types", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "SalesOrder",
              filePath: "tailordb/salesOrder.ts",
              exportName: "salesOrder",
              pluralForm: "SalesOrders",
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    // Should import GraphQL types
    expect(result).toContain(
      'import type { InferCreateInput, InferUpdateInput, InferGqlResult } from "@tailor-platform/sdk/graphql";',
    );

    // Should contain GraphQL module augmentation
    expect(result).toContain('declare module "@tailor-platform/sdk/graphql"');
    expect(result).toContain("interface GeneratedGqlSchema");

    // get query
    expect(result).toContain("salesOrder:");
    expect(result).toContain("variables: { id: string }");
    expect(result).toContain(
      'result: { salesOrder: InferGqlResult<(typeof import("./tailordb/salesOrder"))["salesOrder"]> | null }',
    );

    // list query
    expect(result).toContain("salesOrders:");
    expect(result).toContain(
      'result: { salesOrders: { collection: InferGqlResult<(typeof import("./tailordb/salesOrder"))["salesOrder"]>[] } }',
    );

    // create mutation
    expect(result).toContain("createSalesOrder:");
    expect(result).toContain(
      'variables: { input: InferCreateInput<(typeof import("./tailordb/salesOrder"))["salesOrder"]> }',
    );

    // update mutation
    expect(result).toContain("updateSalesOrder:");
    expect(result).toContain(
      'variables: { id: string; input: InferUpdateInput<(typeof import("./tailordb/salesOrder"))["salesOrder"]> }',
    );

    // delete mutation
    expect(result).toContain("deleteSalesOrder:");
    expect(result).toContain("result: { deleteSalesOrder: { id: string } }");
  });

  it("skips disabled gqlOperations", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "ReadOnly",
              filePath: "tailordb/readOnly.ts",
              exportName: "readOnly",
              pluralForm: "ReadOnlies",
              gqlOperations: { create: false, update: false, delete: false },
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    // Should have get and list queries (read is enabled by default)
    expect(result).toContain("readOnly:");
    expect(result).toContain("readOnlies:");

    // Should NOT have mutations
    expect(result).not.toContain("createReadOnly:");
    expect(result).not.toContain("updateReadOnly:");
    expect(result).not.toContain("deleteReadOnly:");
  });

  it("skips read queries when read is disabled", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "WriteOnly",
              filePath: "tailordb/writeOnly.ts",
              exportName: "writeOnly",
              pluralForm: "WriteOnlies",
              gqlOperations: { read: false },
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    // Should NOT have get/list queries
    expect(result).not.toMatch(/\bwriteOnly:/);
    expect(result).not.toMatch(/\bwriteOnlies:/);

    // Should have mutations
    expect(result).toContain("createWriteOnly:");
    expect(result).toContain("updateWriteOnly:");
    expect(result).toContain("deleteWriteOnly:");
  });

  it("includes bulkUpsert when enabled", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "Item",
              filePath: "tailordb/item.ts",
              exportName: "item",
              pluralForm: "Items",
              bulkUpsert: true,
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");
    expect(result).toContain("bulkUpsertItems:");
  });

  it("does not include bulkUpsert when not enabled", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "Item",
              filePath: "tailordb/item.ts",
              exportName: "item",
              pluralForm: "Items",
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");
    expect(result).not.toContain("bulkUpsertItems:");
  });

  it("generates entries for multiple namespaces", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        db1: {
          types: [
            {
              typeName: "User",
              filePath: "db1/user.ts",
              exportName: "user",
              pluralForm: "Users",
            },
          ],
        },
        db2: {
          types: [
            {
              typeName: "Product",
              filePath: "db2/product.ts",
              exportName: "product",
              pluralForm: "Products",
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    // Both types should be in the GraphQL schema
    expect(result).toContain("createUser:");
    expect(result).toContain("createProduct:");
  });

  it("preserves existing Kysely GeneratedNamespace block", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "User",
              filePath: "tailordb/user.ts",
              exportName: "user",
              pluralForm: "Users",
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    // Should contain both Kysely and GraphQL module augmentations
    expect(result).toContain('declare module "@tailor-platform/sdk/kysely"');
    expect(result).toContain("interface GeneratedNamespace");
    expect(result).toContain('declare module "@tailor-platform/sdk/graphql"');
    expect(result).toContain("interface GeneratedGqlSchema");
  });

  it("does not generate GraphQL block when no types exist", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    // Should still have Kysely block
    expect(result).toContain('declare module "@tailor-platform/sdk/kysely"');

    // Should NOT have GraphQL block
    expect(result).not.toContain('declare module "@tailor-platform/sdk/graphql"');
  });

  it("generates GeneratedGqlTypes with CreateInput and UpdateInput entries", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "SalesOrder",
              filePath: "tailordb/salesOrder.ts",
              exportName: "salesOrder",
              pluralForm: "SalesOrders",
            },
            {
              typeName: "Customer",
              filePath: "tailordb/customer.ts",
              exportName: "customer",
              pluralForm: "Customers",
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    expect(result).toContain("interface GeneratedGqlTypes");
    expect(result).toContain(
      'SalesOrderCreateInput: InferCreateInput<(typeof import("./tailordb/salesOrder"))["salesOrder"]>;',
    );
    expect(result).toContain(
      'SalesOrderUpdateInput: InferUpdateInput<(typeof import("./tailordb/salesOrder"))["salesOrder"]>;',
    );
    expect(result).toContain(
      'CustomerCreateInput: InferCreateInput<(typeof import("./tailordb/customer"))["customer"]>;',
    );
    expect(result).toContain(
      'CustomerUpdateInput: InferUpdateInput<(typeof import("./tailordb/customer"))["customer"]>;',
    );
  });

  it("skips CreateInput when create is disabled", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "ReadOnly",
              filePath: "tailordb/readOnly.ts",
              exportName: "readOnly",
              pluralForm: "ReadOnlies",
              gqlOperations: { create: false, update: false, delete: false },
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    expect(result).not.toContain("ReadOnlyCreateInput:");
    expect(result).not.toContain("ReadOnlyUpdateInput:");
  });

  it("generates only CreateInput when update is disabled", () => {
    const manifest: Manifest = {
      configDir: "/project",
      namespaces: {
        tailordb: {
          types: [
            {
              typeName: "AppendOnly",
              filePath: "tailordb/appendOnly.ts",
              exportName: "appendOnly",
              pluralForm: "AppendOnlies",
              gqlOperations: { update: false },
            },
          ],
        },
      },
    };

    const result = generateDts(manifest, "/project");

    expect(result).toContain("AppendOnlyCreateInput:");
    expect(result).not.toContain("AppendOnlyUpdateInput:");
  });
});
