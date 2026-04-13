import { describe, it, expect } from "vitest";
import { SecretsSchema } from "./schema";

function wrap(
  vaults: Record<string, Record<string, string | null | undefined>>,
  ignoreNullishValues = false,
) {
  return { vaults, options: { ignoreNullishValues } };
}

describe("SecretsSchema validation", () => {
  it("accepts valid vault and secret names", () => {
    const valid = wrap({
      "my-vault": {
        "my-secret": "secret-value",
      },
    });
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  it("accepts empty secret value", () => {
    const valid = wrap({
      "my-vault": {
        "my-secret": "",
      },
    });
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  it("accepts names with only digits", () => {
    const valid = wrap({
      "123": {
        "456": "value",
      },
    });
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  it("accepts names at maximum length (63 characters)", () => {
    const name = `a${"b".repeat(61)}c`;
    expect(name).toHaveLength(63);
    const valid = wrap({ [name]: { [name]: "value" } });
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  it("accepts names at minimum length (3 characters)", () => {
    const valid = wrap({ abc: { def: "value" } });
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  it("rejects vault name with uppercase letters", () => {
    const invalid = wrap({ "My-Vault": { "my-secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow();
  });

  it("rejects secret name with uppercase letters", () => {
    const invalid = wrap({ "my-vault": { "My-Secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow();
  });

  it("rejects name starting with hyphen", () => {
    const invalid = wrap({ "-my-vault": { "my-secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow();
  });

  it("rejects name ending with hyphen", () => {
    const invalid = wrap({ "my-vault-": { "my-secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow();
  });

  it("rejects name shorter than 3 characters", () => {
    const invalid = wrap({ ab: { "my-secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow();
  });

  it("rejects name longer than 63 characters", () => {
    const name = `a${"b".repeat(62)}c`;
    expect(name).toHaveLength(64);
    const invalid = wrap({ [name]: { "my-secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow();
  });

  it("rejects name with underscores", () => {
    const invalid = wrap({ my_vault: { "my-secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow();
  });

  it("accepts multiple vaults with multiple secrets", () => {
    const valid = wrap({
      "vault-1": {
        "secret-a": "value-a",
        "secret-b": "value-b",
      },
      "vault-2": {
        "secret-c": "value-c",
      },
    });
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  it("accepts nullish secret values", () => {
    const valid = wrap(
      {
        "my-vault": {
          "my-secret": undefined,
          "other-secret": null,
        },
      },
      true,
    );
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  it("accepts ignoreNullishValues option", () => {
    const valid = wrap({ "my-vault": { "my-secret": "value" } }, true);
    const parsed = SecretsSchema.parse(valid);
    expect(parsed.options.ignoreNullishValues).toBe(true);
  });
});
