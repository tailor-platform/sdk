import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkDirContext,
  expectEnumValues,
  expectFieldNames,
  expectFieldType,
  expectTimestamps,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- challenge tests inspect generated SDK metadata
function extractValidateFn(validate: any): (input: any) => boolean {
  if (typeof validate === "function") return validate;
  const first = validate[0];
  if (typeof first === "function") return first;
  if (Array.isArray(first) && typeof first[0] === "function") return first[0];
  throw new Error("Could not extract validate function");
}

describe.skipIf(!workDirReady)("002-tailordb-api-design", () => {
  test("product model has the expected fields", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    expect(mod.product.name).toBe("Product");
    expectFieldNames(mod.product, [
      "name",
      "slug",
      "price",
      "status",
      "tags",
      "createdAt",
      "updatedAt",
    ]);
  });

  test("fields use TailorDB builders and metadata", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    expectFieldType(mod.product.fields.name, "string", { required: true });
    expectFieldType(mod.product.fields.slug, "string", { required: true, unique: true });
    expectFieldType(mod.product.fields.price, "float", { required: true });
    expectEnumValues(mod.product.fields.status, ["DRAFT", "ACTIVE", "ARCHIVED"]);
    expect(mod.product.fields.tags.type).toBe("string");
    expect(mod.product.fields.tags.metadata.array).toBe(true);
    expect(mod.product.fields.tags.metadata.required).toBe(false);
    expectTimestamps(mod.product);
  });

  test("slug hook lowercases values and preserves falsy input as empty string", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    const hook = mod.product.fields.slug.metadata.hooks?.create;
    expect(hook).toBeDefined();
    expect(hook({ value: "SKU-ABC", data: {}, user: {} })).toBe("sku-abc");
    expect(hook({ value: null, data: {}, user: {} })).toBe("");
  });

  test("price validation rejects negative values", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    const validate = mod.product.fields.price.metadata.validate;
    expect(validate).toBeDefined();
    const fn = extractValidateFn(validate);
    expect(fn({ value: 0, data: {}, user: {} })).toBe(true);
    expect(fn({ value: -1, data: {}, user: {} })).toBe(false);
  });

  test("product has a non-empty description", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    expect(mod.product.metadata.description).toBeDefined();
    expect(mod.product.metadata.description.length).toBeGreaterThan(0);
  });

  test("tailor.config.ts points TailorDB to model files", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(mod.default.name).toBe("product-catalog");
    expect(mod.default.db.tailordb.files).toEqual(["./tailordb/*.ts"]);
  });
});
