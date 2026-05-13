import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m07-db-type-indexes-composite", () => {
  test("order model is named 'Order' and exposes both fields", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
    expect(mod.order.name).toBe("Order");
    expect(mod.order.fields.status.type).toBe("string");
    expect(mod.order.fields.createdAt.type).toBe("datetime");
  });

  test("a single composite index over [status, createdAt] is registered", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/order.ts"));
    const indexes = mod.order.metadata.indexes;
    expect(indexes).toBeDefined();
    const keys = Object.keys(indexes);
    expect(keys).toHaveLength(1);
    const first = indexes[keys[0]];
    expect(first.fields).toEqual(["status", "createdAt"]);
    expect(first.unique).toBe(false);
  });
});
