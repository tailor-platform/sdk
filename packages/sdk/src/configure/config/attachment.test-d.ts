import { expectTypeOf, test } from "vitest";
import { defineAuth } from "#/configure/services/auth/index";
import { defineIdp } from "#/configure/services/idp/index";
import { defineConfig } from "./index";

test("accepts attached and legacy services", () => {
  expectTypeOf(
    defineConfig({
      name: "app",
      auth: { name: "auth", attach: true },
      idp: [
        { name: "idp", attach: true },
        { name: "legacy", external: true },
      ],
      resolver: { attached: { attach: true }, legacy: { external: true } },
    }),
  ).toBeObject();
});

test("rejects conflicting attachment options even through variables", () => {
  const both = { attach: true as const, external: true as const };
  const unattached = { attach: false as const };
  const ownedResolver = { attach: true as const, files: [] };
  const ownedAuth = {
    ...defineAuth("auth", { machineUserAttributes: {}, machineUsers: {} }),
    attach: true as const,
  };
  const ownedIdp = { ...defineIdp("idp", { clients: ["default"] }), attach: true as const };
  // @ts-expect-error Legacy and new attachment options cannot be combined.
  expectTypeOf(defineConfig({ name: "app", auth: { name: "auth", ...both } })).toBeObject();
  // @ts-expect-error Legacy and new attachment options cannot be combined.
  expectTypeOf(defineConfig({ name: "app", idp: [{ name: "idp", ...both }] })).toBeObject();
  // @ts-expect-error Legacy and new attachment options cannot be combined.
  expectTypeOf(defineConfig({ name: "app", resolver: { ns: both } })).toBeObject();
  // @ts-expect-error Auth only supports attachment.
  expectTypeOf(defineConfig({ name: "app", auth: { name: "auth", ...unattached } })).toBeObject();
  // @ts-expect-error IdP only supports attachment.
  expectTypeOf(defineConfig({ name: "app", idp: [{ name: "idp", ...unattached }] })).toBeObject();
  // @ts-expect-error Resolver only supports attachment.
  expectTypeOf(defineConfig({ name: "app", resolver: { ns: unattached } })).toBeObject();
  // @ts-expect-error Owned resolver definitions cannot configure attachment.
  expectTypeOf(defineConfig({ name: "app", resolver: { ns: ownedResolver } })).toBeObject();
  // @ts-expect-error Owned auth definitions cannot configure attachment.
  expectTypeOf(defineConfig({ name: "app", auth: ownedAuth })).toBeObject();
  // @ts-expect-error Owned IdP definitions cannot configure attachment.
  expectTypeOf(defineConfig({ name: "app", idp: [ownedIdp] })).toBeObject();
});
