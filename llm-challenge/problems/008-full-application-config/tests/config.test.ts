import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { importPath } from "../../../shared/helpers.js";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));

describe.skipIf(!workDirReady)("008-full-application-config", () => {
  const configPath = path.join(workDir, "tailor.config.ts");

  // --- File existence ---

  test("tailor.config.ts exists", () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  // --- Default export (config) ---

  test("has default export", async () => {
    const mod = await importPath(configPath);
    expect(mod.default).toBeDefined();
  });

  test("config name is 'challenge-008'", async () => {
    const mod = await importPath(configPath);
    expect(mod.default.name).toBe("challenge-008");
  });

  test("config has db.tailordb defined", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.db).toBeDefined();
    expect(config.db.tailordb).toBeDefined();
  });

  test("config has cors array with at least 1 entry", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.cors).toBeDefined();
    expect(Array.isArray(config.cors)).toBe(true);
    expect(config.cors.length).toBeGreaterThanOrEqual(1);
  });

  // --- Static websites ---

  test("config has staticWebsites array with at least 1 entry", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.staticWebsites).toBeDefined();
    expect(Array.isArray(config.staticWebsites)).toBe(true);
    expect(config.staticWebsites.length).toBeGreaterThanOrEqual(1);
  });

  test("first static website name is 'my-frontend'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.staticWebsites[0].name).toBe("my-frontend");
  });

  test("first static website has description 'Frontend application'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.staticWebsites[0].description).toBe("Frontend application");
  });

  // --- IdP ---

  test("config has idp array with at least 1 entry", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.idp).toBeDefined();
    expect(Array.isArray(config.idp)).toBe(true);
    expect(config.idp.length).toBeGreaterThanOrEqual(1);
  });

  test("first idp name is 'my-idp'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.idp[0].name).toBe("my-idp");
  });

  test("first idp authorization is 'loggedIn'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.idp[0].authorization).toBe("loggedIn");
  });

  // --- Auth ---

  test("config has auth defined", async () => {
    const mod = await importPath(configPath);
    expect(mod.default.auth).toBeDefined();
  });

  test("auth name is 'my-auth'", async () => {
    const mod = await importPath(configPath);
    expect(mod.default.auth.name).toBe("my-auth");
  });

  test("auth userProfile has usernameField 'email'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.auth.userProfile).toBeDefined();
    expect(config.auth.userProfile.usernameField).toBe("email");
  });

  test("auth has machineUsers 'admin-machine-user'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers).toBeDefined();
    expect(config.auth.machineUsers["admin-machine-user"]).toBeDefined();
  });

  test("admin-machine-user has role 'admin'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers["admin-machine-user"].attributes.role).toBe("admin");
  });

  test("auth has machineUsers 'batch-worker'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers["batch-worker"]).toBeDefined();
  });

  test("batch-worker has role 'editor'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers["batch-worker"].attributes.role).toBe("editor");
  });

  test("auth has oauth2Clients 'web-app'", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    expect(config.auth.oauth2Clients).toBeDefined();
    expect(config.auth.oauth2Clients["web-app"]).toBeDefined();
  });

  test("web-app has correct grantTypes", async () => {
    const mod = await importPath(configPath);
    const config = mod.default;
    const webApp = config.auth.oauth2Clients["web-app"];
    expect(webApp.grantTypes).toBeDefined();
    expect(webApp.grantTypes).toContain("authorization_code");
    expect(webApp.grantTypes).toContain("refresh_token");
  });

  test("auth has idProvider defined", async () => {
    const mod = await importPath(configPath);
    expect(mod.default.auth.idProvider).toBeDefined();
  });

  // --- Generators ---

  test("has named export 'generators'", async () => {
    const mod = await importPath(configPath);
    expect(mod.generators).toBeDefined();
  });

  test("generators is an array with at least 1 entry", async () => {
    const mod = await importPath(configPath);
    expect(Array.isArray(mod.generators)).toBe(true);
    expect(mod.generators.length).toBeGreaterThanOrEqual(1);
  });

  test("first generator is '@tailor-platform/kysely-type'", async () => {
    const mod = await importPath(configPath);
    expect(mod.generators[0][0]).toBe("@tailor-platform/kysely-type");
  });

  test("first generator has distPath './generated/db.ts'", async () => {
    const mod = await importPath(configPath);
    expect(mod.generators[0][1].distPath).toBe("./generated/db.ts");
  });
});
