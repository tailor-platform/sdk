import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("015-features-indexes", () => {
  const productPath = path.join(workDir, "tailordb/product.ts");

  test("tailordb/product.ts exists", () => {
    expect(fs.existsSync(productPath)).toBe(true);
  });

  test("product is a named export", async () => {
    const mod = await import(productPath);
    expect(mod.product).toBeDefined();
  });

  test("product model has correct name", async () => {
    const { product } = await import(productPath);
    expect(product.name).toBe("Product");
  });

  test("product model has plural form Products", async () => {
    const { product } = await import(productPath);
    expect(product.metadata.settings?.pluralForm).toBe("Products");
  });

  test("product model has all required fields", async () => {
    const { product } = await import(productPath);
    const fieldNames = Object.keys(product.fields);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("sku");
    expect(fieldNames).toContain("price");
    expect(fieldNames).toContain("stock");
    expect(fieldNames).toContain("category");
    expect(fieldNames).toContain("isActive");
    expect(fieldNames).toContain("createdAt");
    expect(fieldNames).toContain("updatedAt");
  });

  test("name is a required string with index", async () => {
    const { product } = await import(productPath);
    const field = product.fields.name;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
    expect(field.metadata.index).toBe(true);
  });

  test("sku is a required string and unique", async () => {
    const { product } = await import(productPath);
    const field = product.fields.sku;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
    expect(field.metadata.unique).toBe(true);
  });

  test("price is a required float", async () => {
    const { product } = await import(productPath);
    const field = product.fields.price;
    expect(field.type).toBe("float");
    expect(field.metadata.required).toBe(true);
  });

  test("stock is a required integer", async () => {
    const { product } = await import(productPath);
    const field = product.fields.stock;
    expect(field.type).toBe("integer");
    expect(field.metadata.required).toBe(true);
  });

  test("category is a required string", async () => {
    const { product } = await import(productPath);
    const field = product.fields.category;
    expect(field.type).toBe("string");
    expect(field.metadata.required).toBe(true);
  });

  test("isActive is a required boolean", async () => {
    const { product } = await import(productPath);
    const field = product.fields.isActive;
    expect(field.type).toBe("boolean");
    expect(field.metadata.required).toBe(true);
  });

  test("features include aggregation", async () => {
    const { product } = await import(productPath);
    expect(product.metadata.settings?.aggregation).toBe(true);
  });

  test("features include bulkUpsert", async () => {
    const { product } = await import(productPath);
    expect(product.metadata.settings?.bulkUpsert).toBe(true);
  });

  test("has composite index idx_category_active", async () => {
    const { product } = await import(productPath);
    const indexes = product.metadata.indexes;
    expect(indexes).toBeDefined();
    expect(indexes.idx_category_active).toBeDefined();
    expect(indexes.idx_category_active.fields).toEqual(["category", "isActive"]);
  });

  test("timestamps are present with correct types", async () => {
    const { product } = await import(productPath);
    expect(product.fields.createdAt.type).toBe("datetime");
    expect(product.fields.updatedAt.type).toBe("datetime");
  });
});
