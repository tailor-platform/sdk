import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h11-config-multi-staticwebsite-cors-redirect", () => {
  test("two static websites are registered with name-derived URL placeholders", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    expect(Array.isArray(config.staticWebsites)).toBe(true);
    expect(config.staticWebsites.length).toBe(2);
    const byName = Object.fromEntries(
      config.staticWebsites.map((s: { name: string; url: string }) => [s.name, s.url]),
    );
    expect(byName["admin-frontend"]).toBe("admin-frontend:url");
    expect(byName["public-frontend"]).toBe("public-frontend:url");
  });

  test("CORS allow-list contains exactly the two site URLs", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    expect(Array.isArray(config.cors)).toBe(true);
    expect(config.cors).toHaveLength(2);
    expect(new Set(config.cors)).toEqual(new Set(["admin-frontend:url", "public-frontend:url"]));
  });

  test("each OAuth2 client redirect URI derives from the matching site (no cross-wire)", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const auth = mod.auth ?? mod.default.auth;
    const clients = auth.oauth2Clients;
    expect(clients).toBeDefined();
    expect(clients.admin.redirectURIs).toEqual(["admin-frontend:url/callback"]);
    expect(clients.public.redirectURIs).toEqual(["public-frontend:url/callback"]);
    // Defense against silent cross-wiring: admin client must NOT reference the
    // public site's placeholder, and vice versa.
    for (const uri of clients.admin.redirectURIs as string[]) {
      expect(uri).not.toContain("public-frontend:url");
    }
    for (const uri of clients.public.redirectURIs as string[]) {
      expect(uri).not.toContain("admin-frontend:url");
    }
  });

  test("no hard-coded host literal sneaks into cors or redirect URIs", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    const collected = [
      ...config.cors,
      ...(
        Object.values(config.auth.oauth2Clients) as Array<{
          redirectURIs: string[];
        }>
      ).flatMap((c) => c.redirectURIs),
    ];
    for (const value of collected) {
      expect(value).not.toMatch(/https?:\/\//);
    }
  });
});
