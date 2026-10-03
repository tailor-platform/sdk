import { describe, expect, test } from "vitest";
import { defineAuth } from "#/configure/services/auth/index";
import { defineIdp } from "#/configure/services/idp/index";
import { db } from "#/configure/services/tailordb/schema";
import { AppConfigSchema } from "./schema";

test("normalizes legacy attachments for every service without mutating the input", () => {
  const input = {
    name: "app",
    db: { shared: { external: true } },
    resolver: { shared: { external: true } },
    auth: { name: "shared-auth", external: true },
    idp: [{ name: "shared-idp", external: true }],
  };
  const original = structuredClone(input);

  expect(AppConfigSchema.parse(input)).toEqual({
    name: "app",
    db: { shared: { attach: true } },
    resolver: { shared: { attach: true } },
    auth: { name: "shared-auth", attach: true },
    idp: [{ name: "shared-idp", attach: true }],
  });
  expect(input).toEqual(original);
});

describe.each(["auth", "idp", "resolver"] as const)("%s attachment", (service) => {
  function config(entry: object) {
    const value = service === "resolver" ? entry : { name: "shared", ...entry };
    return {
      name: "app",
      [service]: service === "idp" ? [value] : service === "resolver" ? { shared: value } : value,
    };
  }

  test.each([{ attach: true }, { external: true }])("accepts %j", (entry) => {
    expect(AppConfigSchema.safeParse(config(entry)).success).toBe(true);
  });

  test.each([
    { attach: false },
    { attach: true, external: true },
    { attach: true, schemaFrom: "owner.ts" },
    { attach: true, files: [] },
    { attach: true, machineUsers: {} },
    { attach: true, clients: [] },
    { external: false },
  ])("rejects %j", (entry) => {
    expect(AppConfigSchema.safeParse(config(entry)).success).toBe(false);
  });
});

test("preserves owned service definitions", () => {
  const auth = defineAuth("own-auth", {
    machineUserAttributes: { role: db.string() },
    machineUsers: {},
  });
  const idp = defineIdp("own-idp", { clients: ["default"] });
  const ownedDb = { files: [], gqlOperations: "query" as const };
  const resolver = { files: [] };
  const parsed = AppConfigSchema.parse({
    name: "app",
    db: { own: ownedDb },
    auth,
    idp: [idp],
    resolver: { own: resolver },
  });

  expect(parsed.db?.own).toBe(ownedDb);
  expect(parsed.auth).toBe(auth);
  expect(parsed.idp?.[0]).toBe(idp);
  expect(parsed.resolver?.own).toBe(resolver);
});
