import { describe, it, expect } from "vitest";
import { IdPUserAuthPolicySchema } from "./schema";

describe("IdPUserAuthPolicySchema validation", () => {
  it("accepts valid password policy configuration", () => {
    const validPolicy = {
      passwordRequireUppercase: true,
      passwordRequireLowercase: true,
      passwordRequireNonAlphanumeric: true,
      passwordRequireNumeric: true,
      passwordMinLength: 10,
      passwordMaxLength: 20,
    };

    expect(() => IdPUserAuthPolicySchema.parse(validPolicy)).not.toThrow();
  });

  it("accepts minimum password length", () => {
    const policy = {
      passwordMinLength: 6,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  it("accepts maximum password length", () => {
    const policy = {
      passwordMaxLength: 4096,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  it("rejects passwordMinLength below minimum (5)", () => {
    const policy = {
      passwordMinLength: 5,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "passwordMinLength must be between 6 and 30",
    );
  });

  it("rejects passwordMinLength above maximum (31)", () => {
    const policy = {
      passwordMinLength: 31,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "passwordMinLength must be between 6 and 30",
    );
  });

  it("rejects passwordMaxLength below minimum (5)", () => {
    const policy = {
      passwordMaxLength: 5,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "passwordMaxLength must be between 6 and 4096",
    );
  });

  it("rejects passwordMaxLength above maximum (4097)", () => {
    const policy = {
      passwordMaxLength: 4097,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "passwordMaxLength must be between 6 and 4096",
    );
  });

  it("rejects when passwordMinLength > passwordMaxLength", () => {
    const policy = {
      passwordMinLength: 20,
      passwordMaxLength: 10,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "passwordMinLength must be less than or equal to passwordMaxLength",
    );
  });

  it("accepts when passwordMinLength equals passwordMaxLength", () => {
    const policy = {
      passwordMinLength: 10,
      passwordMaxLength: 10,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  it("returns undefined for unspecified fields (allows platform defaults)", () => {
    const policy = {};

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result).toEqual({});
    expect(result.useNonEmailIdentifier).toBeUndefined();
    expect(result.allowSelfPasswordReset).toBeUndefined();
    expect(result.passwordRequireUppercase).toBeUndefined();
    expect(result.passwordRequireLowercase).toBeUndefined();
    expect(result.passwordRequireNonAlphanumeric).toBeUndefined();
    expect(result.passwordRequireNumeric).toBeUndefined();
    expect(result.passwordMinLength).toBeUndefined();
    expect(result.passwordMaxLength).toBeUndefined();
  });

  it("accepts partial password policy configuration", () => {
    const policy = {
      passwordRequireUppercase: true,
      passwordMinLength: 8,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.passwordRequireUppercase).toBe(true);
    expect(result.passwordMinLength).toBe(8);
    expect(result.passwordRequireLowercase).toBeUndefined();
    expect(result.passwordMaxLength).toBeUndefined();
  });
});
