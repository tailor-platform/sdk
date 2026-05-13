import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m18-config-static-website-url", () => {
  test("config exposes a static website whose url placeholder is reused in CORS", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    expect(Array.isArray(config.staticWebsites)).toBe(true);
    expect(config.staticWebsites.length).toBeGreaterThanOrEqual(1);
    const site = config.staticWebsites[0];
    expect(site.url).toBe(`${site.name}:url`);
    expect(Array.isArray(config.cors)).toBe(true);
    expect(config.cors[0]).toBe(site.url);
  });

  test("oauth2 redirect URI for the 'web' client is anchored at the same static website url", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    const site = config.staticWebsites[0];
    const webClient = config.auth.oauth2Clients?.web;
    expect(webClient).toBeDefined();
    expect(Array.isArray(webClient.redirectURIs)).toBe(true);
    expect(webClient.redirectURIs[0]).toBe(`${site.url}/callback`);
    // Ensure the redirect is built from the website url placeholder, not a hard-coded host.
    expect(webClient.redirectURIs[0].startsWith(`${site.name}:url`)).toBe(true);
  });
});
