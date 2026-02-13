import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("034-auth-standalone", () => {
  const configPath = path.join(workDir, "tailor.config.ts");

  test("tailor.config.ts exists", () => {
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test("has default export", async () => {
    const mod = await import(configPath);
    expect(mod.default).toBeDefined();
  });

  test("config name is 'challenge-034'", async () => {
    const mod = await import(configPath);
    expect(mod.default.name).toBe("challenge-034");
  });

  test("auth name is 'app-auth'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth).toBeDefined();
    expect(config.auth.name).toBe("app-auth");
  });

  test("auth userProfile references user type with usernameField 'email'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.userProfile).toBeDefined();
    expect(config.auth.userProfile.usernameField).toBe("email");
  });

  test("auth has machineUsers 'system-admin' and 'batch-worker'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers).toBeDefined();
    expect(config.auth.machineUsers["system-admin"]).toBeDefined();
    expect(config.auth.machineUsers["batch-worker"]).toBeDefined();
  });

  test("system-admin attributes has role 'admin'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers["system-admin"].attributes.role).toBe("admin");
  });

  test("batch-worker attributes has role 'editor'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.machineUsers["batch-worker"].attributes.role).toBe("editor");
  });

  test("oauth2Clients has 'web-client'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.oauth2Clients).toBeDefined();
    expect(config.auth.oauth2Clients["web-client"]).toBeDefined();
  });

  test("web-client has correct grantTypes", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    const webClient = config.auth.oauth2Clients["web-client"];
    expect(webClient.grantTypes).toBeDefined();
    expect(webClient.grantTypes).toContain("authorization_code");
    expect(webClient.grantTypes).toContain("refresh_token");
  });

  test("idp array has entry with name 'app-idp'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.idp).toBeDefined();
    expect(Array.isArray(config.idp)).toBe(true);
    expect(config.idp.length).toBeGreaterThanOrEqual(1);
    expect(config.idp[0].name).toBe("app-idp");
  });

  test("idp authorization is 'loggedIn'", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.idp[0].authorization).toBe("loggedIn");
  });

  test("auth idProvider is defined", async () => {
    const mod = await import(configPath);
    const config = mod.default;
    expect(config.auth.idProvider).toBeDefined();
  });
});
