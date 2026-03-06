import { describe, expect, it } from "vitest";
import { defineSecretManager } from "./index";

describe("defineSecretManager", () => {
  it("should have get and getAll methods", () => {
    const secrets = defineSecretManager({
      "my-vault": {
        API_KEY: "test-key",
        DB_PASSWORD: "test-password",
      },
    });

    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.getAll).toBe("function");
  });

  it("should support multiple vaults", () => {
    const secrets = defineSecretManager({
      vault1: {
        SECRET_A: "value-a",
      },
      vault2: {
        SECRET_B: "value-b",
      },
    });

    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.getAll).toBe("function");
  });
});
