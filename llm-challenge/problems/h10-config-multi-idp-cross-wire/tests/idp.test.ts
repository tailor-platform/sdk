import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("h10-config-multi-idp-cross-wire", () => {
  test("two IdPs are registered with their declared client lists", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    expect(Array.isArray(config.idp)).toBe(true);
    expect(config.idp.length).toBe(2);
    const byName = Object.fromEntries(
      config.idp.map((i: { name: string; clients: string[] }) => [i.name, i.clients]),
    );
    expect(byName["staff-idp"]).toEqual(["staff-portal"]);
    expect(byName["customer-idp"]).toEqual(["customer-app"]);
  });

  test("auth.idProvider binds to the staff IdP namespace through provider()", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const auth = mod.auth ?? mod.default.auth;
    expect(auth.idProvider).toBeDefined();
    expect(auth.idProvider.kind).toBe("BuiltInIdP");
    expect(auth.idProvider.namespace).toBe("staff-idp");
    expect(auth.idProvider.name).toBe("primary");
    expect(auth.idProvider.clientName).toBe("staff-portal");
  });

  test("the auth idProvider's clientName appears in the staff IdP's clients (no cross-wire)", async () => {
    const mod = await importPath(path.join(workDir, "tailor.config.ts"));
    const config = mod.default;
    const staff = config.idp.find((i: { name: string }) => i.name === "staff-idp");
    const customer = config.idp.find((i: { name: string }) => i.name === "customer-idp");
    expect(staff).toBeDefined();
    expect(customer).toBeDefined();
    expect(staff.clients).toContain(config.auth.idProvider.clientName);
    // Defense against a silent cross-wire where the client name came from the
    // wrong IdP: customer's clients must NOT contain the chosen client name.
    expect(customer.clients).not.toContain(config.auth.idProvider.clientName);
    // The provider's namespace must agree with the IdP whose clients list
    // contains the chosen client.
    expect(config.auth.idProvider.namespace).toBe(staff.name);
  });
});
