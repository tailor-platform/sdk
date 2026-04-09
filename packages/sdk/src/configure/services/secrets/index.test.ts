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
});
