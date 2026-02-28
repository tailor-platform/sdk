import { describe, expect, test } from "vitest";
import path from "node:path";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("007 - Application Config with Cross-References", () => {
  // ---------------------------------------------------------------------------
  // Config structure
  // ---------------------------------------------------------------------------
  describe("Config structure", () => {
    test("default export exists", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default).toBeDefined();
    });

    test("config name is challenge-007", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.name).toBe("challenge-007");
    });

    test("has db.tailordb configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.db).toBeDefined();
      expect(mod.default.db.tailordb).toBeDefined();
    });

    test("has resolver configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.resolver).toBeDefined();
    });

    test("has executor configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.executor).toBeDefined();
    });

    test("has workflow configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.workflow).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Static websites
  // ---------------------------------------------------------------------------
  describe("Static websites", () => {
    test("has staticWebsites array", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.staticWebsites).toBeDefined();
      expect(Array.isArray(mod.default.staticWebsites)).toBe(true);
    });

    test("staticWebsites has 2 entries", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.staticWebsites.length).toBe(2);
    });

    test("one website has name containing dashboard", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const websites = mod.default.staticWebsites as { name: string }[];
      const dashboardSite = websites.find((w) => w.name.includes("dashboard"));
      expect(dashboardSite, "expected a website with name containing 'dashboard'").toBeDefined();
    });

    test("one website has name containing docs", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const websites = mod.default.staticWebsites as { name: string }[];
      const docsSite = websites.find((w) => w.name.includes("docs"));
      expect(docsSite, "expected a website with name containing 'docs'").toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------
  describe("CORS", () => {
    test("has cors array", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.cors).toBeDefined();
      expect(Array.isArray(mod.default.cors)).toBe(true);
    });

    test("cors has 2 entries", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.cors.length).toBe(2);
    });

    test("cors entries are strings", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      for (const entry of mod.default.cors) {
        expect(typeof entry).toBe("string");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // IDP
  // ---------------------------------------------------------------------------
  describe("IDP", () => {
    test("has idp array", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.idp).toBeDefined();
      expect(Array.isArray(mod.default.idp)).toBe(true);
    });

    test("idp has at least 1 entry", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.idp.length).toBeGreaterThanOrEqual(1);
    });

    test("idp has userAuthPolicy with passwordMinLength >= 8", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const firstIdp = mod.default.idp[0];
      expect(firstIdp.userAuthPolicy).toBeDefined();
      expect(firstIdp.userAuthPolicy.passwordMinLength).toBeGreaterThanOrEqual(8);
      expect(firstIdp.userAuthPolicy.passwordRequireUppercase).toBe(true);
      expect(firstIdp.userAuthPolicy.passwordRequireNumeric).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------
  describe("Auth", () => {
    test("has auth configuration", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.auth).toBeDefined();
    });

    test("auth has userProfile", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.auth.userProfile).toBeDefined();
    });

    test("userProfile.usernameField is email", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.default.auth.userProfile.usernameField).toBe("email");
    });

    test("auth has 3 machine users", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const machineUsers = mod.default.auth.machineUsers;
      expect(machineUsers).toBeDefined();
      const entries = Object.entries(machineUsers);
      expect(entries.length).toBe(3);
    });

    test("machine users have ADMIN, WORKER, and READONLY roles", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const machineUsers = mod.default.auth.machineUsers;
      const entries = Object.entries(machineUsers);
      const roles = entries.map(([, v]) => (v as { attributes: { role: string } }).attributes.role);
      expect(roles).toContain("ADMIN");
      expect(roles).toContain("WORKER");
      expect(roles).toContain("READONLY");
    });

    test("auth has 2 oauth2 clients", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const clients = mod.default.auth.oauth2Clients;
      expect(clients).toBeDefined();
      const entries = Object.entries(clients);
      expect(entries.length).toBe(2);
    });

    test("dashboard client has 2 redirect URIs", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const clients = mod.default.auth.oauth2Clients;
      const clientEntries = Object.entries(clients);
      const dashboardClient = clientEntries.find(([k]) => k.includes("dashboard"));
      expect(
        dashboardClient,
        "expected an OAuth2 client with key containing 'dashboard'",
      ).toBeDefined();
      expect((dashboardClient![1] as { redirectURIs: string[] }).redirectURIs.length).toBe(2);
    });

    test("docs client has 1 redirect URI", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const clients = mod.default.auth.oauth2Clients;
      const clientEntries = Object.entries(clients);
      const docsClient = clientEntries.find(([k]) => k.includes("docs"));
      expect(docsClient, "expected an OAuth2 client with key containing 'docs'").toBeDefined();
      expect((docsClient![1] as { redirectURIs: string[] }).redirectURIs.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-references
  // ---------------------------------------------------------------------------
  describe("Cross-references", () => {
    test("redirect URIs reference website URLs", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const websites = mod.default.staticWebsites as { name: string; url: string }[];
      const clients = mod.default.auth.oauth2Clients;
      const websiteUrls = websites.map((w) => w.url);

      for (const [, client] of Object.entries(clients)) {
        const redirectURIs = (client as { redirectURIs: string[] }).redirectURIs;
        for (const uri of redirectURIs) {
          const matchesWebsite = websiteUrls.some((url: string) => uri.startsWith(url));
          expect(matchesWebsite, `Redirect URI ${uri} should start with a website URL`).toBe(true);
        }
      }
    });

    test("cors entries match website URLs", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const websites = mod.default.staticWebsites as { url: string }[];
      const websiteUrls = websites.map((w) => w.url);

      expect(mod.default.cors.length).toBe(2);
      for (const corsUrl of mod.default.cors) {
        expect(websiteUrls).toContain(corsUrl);
      }
    });

    test("dashboard client redirect URIs use dashboard website URL", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const websites = mod.default.staticWebsites as { name: string; url: string }[];
      const dashboardSite = websites.find((w) => w.name.includes("dashboard"))!;
      const clients = mod.default.auth.oauth2Clients;
      const clientEntries = Object.entries(clients);
      const dashboardClient = clientEntries.find(([k]) => k.includes("dashboard"))!;
      const redirectURIs = (dashboardClient[1] as { redirectURIs: string[] }).redirectURIs;

      for (const uri of redirectURIs) {
        expect(
          uri.startsWith(dashboardSite.url),
          `Dashboard redirect URI ${uri} should start with dashboard URL ${dashboardSite.url}`,
        ).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Generators
  // ---------------------------------------------------------------------------
  describe("Generators", () => {
    test("generators named export exists and is array", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.generators).toBeDefined();
      expect(Array.isArray(mod.generators)).toBe(true);
    });

    test("generators has 2 entries", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      expect(mod.generators.length).toBe(2);
    });

    test("generators include kysely-type and seed", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const generatorNames = mod.generators.map((g: [string, unknown]) => g[0]);
      expect(generatorNames).toContain("@tailor-platform/kysely-type");
      expect(generatorNames).toContain("@tailor-platform/seed");
    });

    test("seed generator references a machine user", async () => {
      const mod = await importPath(path.join(workDir, "tailor.config.ts"));
      const seedGen = mod.generators.find(
        (g: [string, unknown]) => g[0] === "@tailor-platform/seed",
      );
      expect(seedGen).toBeDefined();
      const seedConfig = seedGen[1] as { machineUserName: string };
      expect(seedConfig.machineUserName).toBeDefined();

      const machineUserNames = Object.keys(mod.default.auth.machineUsers);
      expect(machineUserNames).toContain(seedConfig.machineUserName);
    });
  });
});
