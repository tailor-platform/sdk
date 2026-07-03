import { describe, expect, test } from "vitest";
import { SecretsSchema } from "./schema";

function wrap(
  vaults: Record<string, Record<string, string | null | undefined>>,
  ignoreNullishValues = false,
) {
  return { vaults, options: { ignoreNullishValues } };
}

describe("SecretsSchema validation", () => {
  test.each([
    ["valid vault and secret names", { "my-vault": { "my-secret": "secret-value" } }],
    ["empty secret value", { "my-vault": { "my-secret": "" } }],
    ["names with only digits", { "123": { "456": "value" } }],
    ["names at minimum length (3 characters)", { abc: { def: "value" } }],
    [
      "multiple vaults with multiple secrets",
      {
        "vault-1": { "secret-a": "value-a", "secret-b": "value-b" },
        "vault-2": { "secret-c": "value-c" },
      },
    ],
  ] as const)("accepts %s", (_description, vaults) => {
    expect(() => SecretsSchema.parse(wrap(vaults))).not.toThrow();
  });

  test("accepts names at maximum length (63 characters)", () => {
    const name = `a${"b".repeat(61)}c`;
    expect(name).toHaveLength(63);
    const valid = wrap({ [name]: { [name]: "value" } });
    expect(() => SecretsSchema.parse(valid)).not.toThrow();
  });

  test.each([
    ["vault name with uppercase letters", { "My-Vault": { "my-secret": "value" } }],
    ["secret name with uppercase letters", { "my-vault": { "My-Secret": "value" } }],
    ["name starting with hyphen", { "-my-vault": { "my-secret": "value" } }],
    ["name ending with hyphen", { "my-vault-": { "my-secret": "value" } }],
    ["name shorter than 3 characters", { ab: { "my-secret": "value" } }],
    ["name with underscores", { my_vault: { "my-secret": "value" } }],
  ] as const)("rejects %s", (_description, vaults) => {
    expect(() => SecretsSchema.parse(wrap(vaults))).toThrow(/Invalid string/);
  });

  test("rejects name longer than 63 characters", () => {
    const name = `a${"b".repeat(62)}c`;
    expect(name).toHaveLength(64);
    const invalid = wrap({ [name]: { "my-secret": "value" } });
    expect(() => SecretsSchema.parse(invalid)).toThrow(/Invalid string/);
  });

  test("accepts nullish secret values", () => {
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

  test("accepts ignoreNullishValues option", () => {
    const valid = wrap({ "my-vault": { "my-secret": "value" } }, true);
    const parsed = SecretsSchema.parse(valid);
    expect(parsed.options.ignoreNullishValues).toBe(true);
  });
});
