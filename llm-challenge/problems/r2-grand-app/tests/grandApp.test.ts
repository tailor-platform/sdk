import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("r2-grand-app", () => {
  test("tailordb/organization.ts exports an Organization model", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/organization.ts"));
    expect(mod.organization).toBeDefined();
    expect(mod.organization.name).toBe("Organization");
  });

  test("tailordb/member.ts exports a Member model with composite index", async () => {
    const mod = await importPath(path.join(workDir, "tailordb/member.ts"));
    expect(mod.member).toBeDefined();
    expect(mod.member.name).toBe("Member");
    const indexes = (mod.member.metadata?.indexes ?? {}) as Record<string, { fields?: string[] }>;
    const hasComposite = Object.values(indexes).some(
      (idx) =>
        Array.isArray(idx.fields) &&
        idx.fields.includes("organizationId") &&
        idx.fields.includes("email"),
    );
    expect(hasComposite).toBe(true);
  });

  test("resolvers/listOrgMembers.ts default-exports the 'list-org-members' query resolver", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/listOrgMembers.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("list-org-members");
    expect(mod.default.operation).toBe("query");
  });

  test("all five executor files exist and default-export executors with unique names", async () => {
    const executorFiles = [
      "executors/onMemberCreated.ts",
      "executors/onOrgChanged.ts",
      "executors/onIdpUserSync.ts",
      "executors/dailyCleanup.ts",
      "executors/externalSync.ts",
    ];
    const names = new Set<string>();
    for (const f of executorFiles) {
      const full = path.join(workDir, f);
      expect(fs.existsSync(full), `${f} must exist`).toBe(true);
      const mod = await importPath(full);
      expect(mod.default, `${f} must default-export an executor`).toBeDefined();
      expect(typeof mod.default.name).toBe("string");
      expect(mod.default.name.length).toBeGreaterThan(0);
      names.add(mod.default.name);
    }
    expect(names.size).toBe(executorFiles.length);
  });

  test("workflows/onboarding.ts default-exports the 'onboarding' workflow", async () => {
    const mod = await importPath(path.join(workDir, "workflows/onboarding.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("onboarding");
    expect(mod.default.mainJob).toBeDefined();
    expect(mod.default.mainJob.name).toBe("provision-org");
  });

  test("workflows/onboarding.ts has loadOrganization and provisionOrg as named exports", async () => {
    const mod = await importPath(path.join(workDir, "workflows/onboarding.ts"));
    expect(mod.loadOrganization).toBeDefined();
    expect(mod.loadOrganization.name).toBe("load-organization");
    expect(mod.provisionOrg).toBeDefined();
    expect(mod.provisionOrg.name).toBe("provision-org");
  });

  test("workflows/onboarding.ts uses getDB('tailordb') against the Organization table", () => {
    const source = fs.readFileSync(path.join(workDir, "workflows/onboarding.ts"), "utf-8");
    expect(source).toMatch(/getDB\(\s*["']tailordb["']\s*\)/);
    expect(source).toMatch(/selectFrom\(\s*["']Organization["']\s*\)/);
  });

  test("tailor.config.ts default-exports a config with idp, auth, staticWebsites", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("r2-grand-app");
    expect(Array.isArray(mod.default.idp)).toBe(true);
    expect(mod.default.idp.length).toBeGreaterThan(0);
    expect(mod.default.auth).toBeDefined();
    expect(Array.isArray(mod.default.staticWebsites)).toBe(true);
    expect(mod.default.staticWebsites.length).toBeGreaterThan(0);
  });

  test("tailor.config.ts exposes a `plugins` named export that registers kyselyTypePlugin", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    expect(Array.isArray(mod.plugins)).toBe(true);
    const kysely = mod.plugins.find((p: { id: string }) => p.id === "@tailor-platform/kysely-type");
    expect(kysely, "kysely-type plugin must be registered").toBeDefined();
    expect(kysely.pluginConfig.distPath).toBe("./generated/tailordb.ts");
  });

  test("generated/tailordb.ts was emitted by the generate stage", () => {
    const generatedPath = path.join(workDir, "generated/tailordb.ts");
    expect(fs.existsSync(generatedPath)).toBe(true);
    const source = fs.readFileSync(generatedPath, "utf-8");
    expect(source).toMatch(/getDB/);
    expect(source).toMatch(/Organization/);
    expect(source).toMatch(/Member/);
  });
});
