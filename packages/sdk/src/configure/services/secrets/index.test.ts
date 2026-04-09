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

  it("should accept undefined values with skipNullish option", () => {
    const secrets = defineSecretManager(
      {
        "my-vault": {
          "api-key": "test-key",
          "missing-key": undefined,
        },
      },
      { skipNullish: true },
    );

    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.getAll).toBe("function");
  });

  it("should store __skipNullish as non-enumerable property", () => {
    const secrets = defineSecretManager(
      {
        "my-vault": {
          "api-key": "test-key",
        },
      },
      { skipNullish: true },
    );

    // __skipNullish should not appear in Object.keys
    const keys = Object.keys(secrets);
    expect(keys).toEqual(["my-vault"]);

    // But should be accessible directly
    expect((secrets as Record<string, unknown>).__skipNullish).toBe(true);
  });

  it("should default __skipNullish to false when no options provided", () => {
    const secrets = defineSecretManager({
      "my-vault": {
        "api-key": "test-key",
      },
    });

    expect((secrets as Record<string, unknown>).__skipNullish).toBe(false);
  });
});
