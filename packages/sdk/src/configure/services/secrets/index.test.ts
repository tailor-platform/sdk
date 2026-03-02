import { describe, expect, it } from "vitest";
import { defineSecrets } from "./index";

describe("defineSecrets", () => {
  it("should preserve vault and secret structure", () => {
    const secrets = defineSecrets({
      "my-vault": {
        API_KEY: "test-key",
        DB_PASSWORD: "test-password",
      },
    });

    expect(secrets["my-vault"].API_KEY).toBe("test-key");
    expect(secrets["my-vault"].DB_PASSWORD).toBe("test-password");
  });

  it("should support multiple vaults", () => {
    const secrets = defineSecrets({
      vault1: {
        SECRET_A: "value-a",
      },
      vault2: {
        SECRET_B: "value-b",
      },
    });

    expect(secrets.vault1.SECRET_A).toBe("value-a");
    expect(secrets.vault2.SECRET_B).toBe("value-b");
  });

  it("should allow undefined values for config-time declarations", () => {
    const secrets = defineSecrets({
      "my-vault": {
        API_KEY: process.env.API_KEY,
      },
    });

    expect(secrets["my-vault"].API_KEY).toBeUndefined();
  });

  it("should have get and getAll methods", () => {
    const secrets = defineSecrets({
      "my-vault": {
        API_KEY: "test-key",
      },
    });

    expect(typeof secrets.get).toBe("function");
    expect(typeof secrets.getAll).toBe("function");
  });
});
