import { describe, expect, test } from "vitest";
import { getApplicationAuthNamespace } from "./auth-namespace";

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
