import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m04-db-field-validate-message", () => {
  test("product model is named 'Product' and exposes the price field", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    expect(mod.product.name).toBe("Product");
    expect(Object.keys(mod.product.fields)).toContain("price");
    expect(mod.product.fields.price.type).toBe("float");
  });

  test("a non-negative price parses cleanly", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    const result = mod.product.fields.price.parse({
      value: 0,
      data: {},
      user: {},
    });
    expect(result.issues).toBeUndefined();
  });

  test("a negative price reports the configured message", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/product.ts"));
    const result = mod.product.fields.price.parse({
      value: -1,
      data: {},
      user: {},
    });
    expect(result.issues).toBeDefined();
    const messages = (result.issues ?? []).map((issue: { message: string }) => issue.message);
    expect(messages).toContain("price must be >= 0");
  });
});
