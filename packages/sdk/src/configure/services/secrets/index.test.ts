import { describe, expect, it } from "vitest";
import { defineSecretManager } from "./index";

describe("defineSecretManager", () => {
  it("should have get and getAll methods", () => {
    const secrets = defineSecretManager({
      "my-vault": {
        "api-key": "test-key",
        "db-password": "test-password",
      },
    });

    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.getAll).toBe("function");
  });

  it("should support multiple vaults", () => {
    const secrets = defineSecretManager({
      "vault-1": {
        "secret-a": "value-a",
      },
      "vault-2": {
        "secret-b": "value-b",
      },
    });

    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.getAll).toBe("function");
  });

  it("should store vaults and options as separate properties", () => {
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

  it("should accept undefined values with ignoreNullishValues option", () => {
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
    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.getAll).toBe("function");
  });

  it("should not expose get/getAll as enumerable properties", () => {
    const secrets = defineSecretManager({
      "my-vault": {
        "api-key": "test-key",
      },
    });

    const keys = Object.keys(secrets);
    expect(keys).toEqual(["vaults", "options"]);
  });
});
