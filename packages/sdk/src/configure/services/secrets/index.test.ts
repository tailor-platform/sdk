import { describe, expect, test } from "vitest";
import { defineSecretManager } from "./index";

describe("defineSecretManager", () => {
  test("should have get and getAll methods", () => {
    const secrets = defineSecretManager({
      "my-vault": {
        "api-key": "test-key",
        "db-password": "test-password",
      },
    });

    // oxlint-disable-next-line typescript/no-deprecated -- Verify the deprecated method still exists until it is removed.
    expect(typeof secrets.get).toBe("function");
    // oxlint-disable-next-line typescript/no-deprecated -- Verify the deprecated method still exists until it is removed.
    expect(typeof secrets.getAll).toBe("function");
  });

  test("should support multiple vaults", () => {
    const secrets = defineSecretManager({
      "vault-1": {
        "secret-a": "value-a",
      },
      "vault-2": {
        "secret-b": "value-b",
      },
    });

    // oxlint-disable-next-line typescript/no-deprecated -- Verify the deprecated method still exists until it is removed.
    expect(typeof secrets.get).toBe("function");
    // oxlint-disable-next-line typescript/no-deprecated -- Verify the deprecated method still exists until it is removed.
    expect(typeof secrets.getAll).toBe("function");
  });

  test("should store vaults and options as separate properties", () => {
    const secrets = defineSecretManager({
      "my-vault": {
        "api-key": "test-key",
      },
    });

    expect(secrets.vaults).toEqual({
      "my-vault": { "api-key": "test-key" },
    });
    expect(secrets.options).toEqual({ ignoreNullishValues: false });
  });

  test("should accept undefined values with ignoreNullishValues option", () => {
    const secrets = defineSecretManager(
      {
        "my-vault": {
          "api-key": "test-key",
          "missing-key": undefined,
        },
      },
      { ignoreNullishValues: true },
    );

    expect(secrets.vaults["my-vault"]["missing-key"]).toBeUndefined();
    expect(secrets.options).toEqual({ ignoreNullishValues: true });
    // oxlint-disable-next-line typescript/no-deprecated -- Verify the deprecated method still exists until it is removed.
    expect(typeof secrets.get).toBe("function");
    // oxlint-disable-next-line typescript/no-deprecated -- Verify the deprecated method still exists until it is removed.
    expect(typeof secrets.getAll).toBe("function");
  });

  test("should not expose get/getAll as enumerable properties", () => {
    const secrets = defineSecretManager({
      "my-vault": {
        "api-key": "test-key",
      },
    });

    const keys = Object.keys(secrets);
    expect(keys).toEqual(["vaults", "options"]);
  });
});
