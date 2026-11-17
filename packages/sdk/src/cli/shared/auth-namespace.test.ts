import { describe, expect, test } from "vitest";
import { getApplicationAuthNamespace, requireApplicationAuthNamespace } from "./auth-namespace";

describe("getApplicationAuthNamespace", () => {
  test("uses the local auth service name first", () => {
    expect(
      getApplicationAuthNamespace({
        authService: { config: { name: "local-auth" } },
        config: { auth: { name: "external-auth", external: true } },
      }),
    ).toBe("local-auth");
  });

  test("uses external auth config name when no local auth service exists", () => {
    expect(
      getApplicationAuthNamespace({
        config: { auth: { name: "external-auth", external: true } },
      }),
    ).toBe("external-auth");
  });

  test("returns undefined when no auth is configured", () => {
    expect(getApplicationAuthNamespace({ config: {} })).toBeUndefined();
  });
});

describe("requireApplicationAuthNamespace", () => {
  test("rejects an application without auth as AUTH_CONFIG_REQUIRED", () => {
    let error: unknown;
    try {
      requireApplicationAuthNamespace({ config: {} });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toMatchObject({
      code: "AUTH_CONFIG_REQUIRED",
      message: "No Auth service configured",
      suggestion: "Ensure tailor.config.ts has an auth config.",
    });
  });
});
