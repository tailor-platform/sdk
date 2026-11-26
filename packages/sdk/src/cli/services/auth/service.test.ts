import { describe, expect, test, vi } from "vitest";
import { createAuthService } from "./service";
import type { TailorDBService } from "#/cli/services/tailordb/service";

type AuthConfig = Parameters<typeof createAuthService>[0];

function tailorDBService(namespace: string, typeNames: string[]): TailorDBService {
  return {
    namespace,
    types: Object.fromEntries(typeNames.map((typeName) => [typeName, {}])),
    loadTypes: vi.fn().mockResolvedValue(undefined),
  } as unknown as TailorDBService;
}

function authConfig(userProfile: Record<string, unknown>): AuthConfig {
  return {
    name: "corp-auth",
    userProfile: { type: { name: "Customer" }, usernameField: "email", ...userProfile },
  } as unknown as AuthConfig;
}

describe("createAuthService userProfile namespace", () => {
  const sharedNamespaces = [
    tailorDBService("shop-db", ["Customer", "Order"]),
    tailorDBService("crm-db", ["Customer"]),
  ];

  test("asks for userProfile.namespace when several namespaces define the table", async () => {
    const auth = createAuthService(
      authConfig({}),
      sharedNamespaces,
      [],
      "/project/tailor.config.ts",
      ["auth", "corp-auth"],
    );

    await expect(auth.resolveNamespaces()).rejects.toMatchObject({
      context: {
        issues: [
          {
            path: ["auth", "corp-auth", "userProfile", "namespace"],
            message: 'Type "Customer" is defined in several TailorDB namespaces: shop-db, crm-db',
          },
        ],
      },
    });
  });
});
