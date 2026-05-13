import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m21-auth-idp-provider-wiring", () => {
  test("auth.idProvider references the defined IdP namespace and a declared client", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const auth = mod.auth ?? mod.default.auth;
    expect(auth.idProvider).toBeDefined();
    expect(auth.idProvider.kind).toBe("BuiltInIdP");
    expect(auth.idProvider.namespace).toBe("my-idp");
    expect(auth.idProvider.name).toBe("primary");
    expect(auth.idProvider.clientName).toBe("default-idp-client");
  });

  test("the IdP is registered with the application configuration", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    expect(Array.isArray(config.idp)).toBe(true);
    expect(config.idp[0].name).toBe("my-idp");
    // The provider's namespace must match the IdP's name (no manual rewiring).
    expect(config.auth.idProvider.namespace).toBe(config.idp[0].name);
  });
});
