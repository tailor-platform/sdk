import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h07-workflow-job-chain-with-tailordb", () => {
  test("tailor.config.ts registers kyselyTypePlugin under distPath './generated/tailordb.ts'", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(Array.isArray(mod.plugins)).toBe(true);
    const kysely = mod.plugins.find((p: { id: string }) => p.id === "@tailor-platform/kysely-type");
    expect(kysely).toBeDefined();
    expect(kysely.pluginConfig.distPath).toBe("./generated/tailordb.ts");
  });

  test("generated/tailordb.ts exists and exposes getDB for the Account namespace", () => {
    const generatedPath = path.join(workDir, "generated/tailordb.ts");
    expect(fs.existsSync(generatedPath)).toBe(true);
    const source = fs.readFileSync(generatedPath, "utf-8");
    expect(source).toMatch(/getDB/);
    expect(source).toMatch(/Account/);
  });

  test("default export is the 'upgrade-flow' workflow with processUpgrade as mainJob", async () => {
    const mod = await importPath(path.join(workDir, "workflows/upgradeFlow.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("upgrade-flow");
    expect(mod.default.mainJob).toBeDefined();
    expect(mod.default.mainJob.name).toBe("process-upgrade");
  });

  test("all three jobs are named exports with the expected job names", async () => {
    const mod = await importPath(path.join(workDir, "workflows/upgradeFlow.ts"));
    expect(mod.loadAccount).toBeDefined();
    expect(mod.loadAccount.name).toBe("load-account");
    expect(mod.computeUpgradeCost).toBeDefined();
    expect(mod.computeUpgradeCost.name).toBe("compute-upgrade-cost");
    expect(mod.processUpgrade).toBeDefined();
    expect(mod.processUpgrade.name).toBe("process-upgrade");
  });

  test("computeUpgradeCost.body returns the table-driven cost", async () => {
    const mod = await importPath(path.join(workDir, "workflows/upgradeFlow.ts"));
    expect(await mod.computeUpgradeCost.body({ currentTier: "free", targetTier: "pro" })).toEqual({
      cost: 20,
    });
    expect(
      await mod.computeUpgradeCost.body({ currentTier: "free", targetTier: "enterprise" }),
    ).toEqual({ cost: 80 });
    expect(
      await mod.computeUpgradeCost.body({ currentTier: "pro", targetTier: "enterprise" }),
    ).toEqual({ cost: 60 });
    // Unknown pairs fall through to 0 (e.g. downgrade or same tier).
    expect(await mod.computeUpgradeCost.body({ currentTier: "pro", targetTier: "pro" })).toEqual({
      cost: 0,
    });
  });

  test("loadAccount queries Account.tier via getDB('tailordb') with where(id=accountId)", () => {
    const source = fs.readFileSync(path.join(workDir, "workflows/upgradeFlow.ts"), "utf-8");
    expect(source).toMatch(/getDB\(\s*["']tailordb["']\s*\)/);
    expect(source).toMatch(/selectFrom\(\s*["']Account["']\s*\)/);
    expect(source).toMatch(/select\(\s*\[\s*["']tier["']/);
    expect(source).toMatch(/where\(\s*["']id["']\s*,\s*["']=["']/);
  });

  test("processUpgrade awaits both child triggers in order", () => {
    const source = fs.readFileSync(path.join(workDir, "workflows/upgradeFlow.ts"), "utf-8");
    // Both child triggers must be awaited; the order check uses string indices.
    const loadIdx = source.search(/await\s+loadAccount\.trigger\(/);
    const costIdx = source.search(/await\s+computeUpgradeCost\.trigger\(/);
    expect(loadIdx).toBeGreaterThan(-1);
    expect(costIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeLessThan(costIdx);
  });
});
