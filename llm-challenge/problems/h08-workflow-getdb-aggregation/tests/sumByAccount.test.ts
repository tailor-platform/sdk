import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h08-workflow-getdb-aggregation", () => {
  test("plugins export registers kyselyTypePlugin with the expected distPath", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(Array.isArray(mod.plugins)).toBe(true);
    const kysely = mod.plugins.find((p: { id: string }) => p.id === "@tailor-platform/kysely-type");
    expect(kysely).toBeDefined();
    expect(kysely.pluginConfig.distPath).toBe("./generated/tailordb.ts");
  });

  test("generated/tailordb.ts exists and exposes the Invoice namespace", async () => {
    const generatedPath = path.join(workDir, "generated/tailordb.ts");
    expect(fs.existsSync(generatedPath)).toBe(true);
    const source = fs.readFileSync(generatedPath, "utf-8");
    expect(source).toMatch(/getDB/);
    expect(source).toMatch(/Invoice/);
    expect(source).toMatch(/accountId/);
  });

  test("workflow exports the aggregation job and a default workflow with that job as mainJob", async () => {
    const mod = await importPath(path.join(workDir, "workflows/sumByAccount.ts"));
    expect(mod.sumInvoicesByAccount).toBeDefined();
    expect(mod.sumInvoicesByAccount.name).toBe("sum-invoices-by-account");
    expect(typeof mod.sumInvoicesByAccount.body).toBe("function");
    expect(mod.default).toBeDefined();
    expect(mod.default.mainJob).toBe(mod.sumInvoicesByAccount);
  });

  test("aggregation body uses sum + groupBy('accountId') via Kysely", async () => {
    const source = fs.readFileSync(path.join(workDir, "workflows/sumByAccount.ts"), "utf-8");
    // The body must aggregate Invoice.amount grouped by accountId. We accept
    // either `fn.sum("amount")` or `sum("amount")` (after destructuring).
    expect(source).toMatch(/sum\(\s*["']amount["']\s*\)/);
    expect(source).toMatch(/groupBy\(\s*["']accountId["']\s*\)/);
    expect(source).toMatch(/selectFrom\(\s*["']Invoice["']\s*\)/);
  });
});
