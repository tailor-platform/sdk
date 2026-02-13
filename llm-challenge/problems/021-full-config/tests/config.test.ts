import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("021-full-config", () => {
  const configPath = path.join(workDir, "tailor.config.ts");

  test("tailor.config.ts exists", () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test("has default export", async () => {
    const mod = await import(configPath);
    expect(mod.default).toBeDefined();
  });

  test("config name is 'challenge-021'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.name).toBe("challenge-021");
  });

  test("config has db.tailordb defined", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.db).toBeDefined();
    expect(config.db.tailordb).toBeDefined();
  });

  test("config has cors array with at least 1 entry", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.cors).toBeDefined();
    expect(Array.isArray(config.cors)).toBe(true);
    expect(config.cors.length).toBeGreaterThanOrEqual(1);
  });

  test("config has auth defined", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth).toBeDefined();
  });

  test("auth name is 'my-auth'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.name).toBe("my-auth");
  });

  test("auth has userProfile with usernameField 'email'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.userProfile).toBeDefined();
    expect(config.auth.userProfile.usernameField).toBe("email");
  });

  test("auth has machineUsers with 'admin-machine-user' key", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers).toBeDefined();
    expect(config.auth.machineUsers["admin-machine-user"]).toBeDefined();
  });

  test("auth has oauth2Clients with 'web-app' key", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.oauth2Clients).toBeDefined();
    expect(config.auth.oauth2Clients["web-app"]).toBeDefined();
  });

  test("oauth2Clients 'web-app' has correct grantTypes", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    const webApp = config.auth.oauth2Clients["web-app"];
    expect(webApp.grantTypes).toBeDefined();
    expect(webApp.grantTypes).toContain("authorization_code");
    expect(webApp.grantTypes).toContain("refresh_token");
  });

  test("config has idp array with at least 1 entry", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.idp).toBeDefined();
    expect(Array.isArray(config.idp)).toBe(true);
    expect(config.idp.length).toBeGreaterThanOrEqual(1);
  });

  test("first idp name is 'my-idp'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.idp[0].name).toBe("my-idp");
  });

  test("first idp authorization is 'loggedIn'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.idp[0].authorization).toBe("loggedIn");
  });

  test("config has staticWebsites array with at least 1 entry", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.staticWebsites).toBeDefined();
    expect(Array.isArray(config.staticWebsites)).toBe(true);
    expect(config.staticWebsites.length).toBeGreaterThanOrEqual(1);
  });

  test("first static website name is 'my-frontend'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.staticWebsites[0].name).toBe("my-frontend");
  });

  test("auth has idProvider defined", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.idProvider).toBeDefined();
  });
});
