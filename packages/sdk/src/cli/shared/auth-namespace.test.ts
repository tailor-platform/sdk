import { describe, expect, test } from "vitest";
import { getApplicationAuthNamespace } from "./auth-namespace";

describe("getApplicationAuthNamespace", () => {
  test("uses the local auth service name first", () => {
    expect(
      getApplicationAuthNamespace({
        authServices: [{ config: { name: "local-auth" } }],
        config: { auth: { name: "external-auth", external: true } },
      }),
    ).toBe("local-auth");
  });

  test("uses external auth config name when no local auth service exists", () => {
    expect(
      getApplicationAuthNamespace({
        authServices: [],
        config: { auth: { name: "external-auth", external: true } },
      }),
    ).toBe("external-auth");
  });

  test("returns undefined when no auth is configured", () => {
    expect(getApplicationAuthNamespace({ authServices: [], config: {} })).toBeUndefined();
  });

  test("refuses to pick one of several Auth services", () => {
    expect(() =>
      getApplicationAuthNamespace({
        authServices: [{ config: { name: "corp-auth" } }, { config: { name: "partner-auth" } }],
      }),
    ).toThrow("An application has one Auth service at most, but 2 were defined");
  });
});
