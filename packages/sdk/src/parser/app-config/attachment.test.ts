import { describe, expect, test } from "vitest";
import { defineAuth } from "#/configure/services/auth/index";
import { defineIdp } from "#/configure/services/idp/index";
import { AppConfigSchema } from "./schema";

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
  expect(
    AppConfigSchema.safeParse({
      name: "app",
      auth: defineAuth("own-auth", { machineUserAttributes: {}, machineUsers: {} }),
      idp: [defineIdp("own-idp", { clients: ["default"] })],
      resolver: { own: { files: [] } },
    }).success,
  ).toBe(true);
});
