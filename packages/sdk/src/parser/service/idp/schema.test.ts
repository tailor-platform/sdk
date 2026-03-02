import { describe, it, expect } from "vitest";
import { IdPUserAuthPolicySchema, IdPSchema, IdPGqlOperationsSchema } from "./schema";

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
    expect(result.allowedEmailDomains).toBeUndefined();
    expect(result.allowGoogleOauth).toBeUndefined();
    expect(result.disablePasswordAuth).toBeUndefined();
  });

  it("accepts allowedEmailDomains with empty array", () => {
    const policy = {
      allowedEmailDomains: [],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowedEmailDomains).toEqual([]);
  });

  it("accepts allowedEmailDomains with single domain", () => {
    const policy = {
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowedEmailDomains).toEqual(["example.com"]);
  });

  it("accepts allowedEmailDomains with multiple domains", () => {
    const policy = {
      allowedEmailDomains: ["example.com", "corp.example.com", "test.org"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowedEmailDomains).toEqual(["example.com", "corp.example.com", "test.org"]);
  });

  it("rejects allowedEmailDomains when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowedEmailDomains: ["example.com"],
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "allowedEmailDomains cannot be set when useNonEmailIdentifier is true",
    );
  });

  it("accepts empty allowedEmailDomains when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowedEmailDomains: [],
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  it("accepts allowedEmailDomains when useNonEmailIdentifier is false", () => {
    const policy = {
      useNonEmailIdentifier: false,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowedEmailDomains).toEqual(["example.com"]);
  });

  it("accepts allowGoogleOauth as true with allowedEmailDomains", () => {
    const policy = {
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowGoogleOauth).toBe(true);
  });

  it("accepts allowGoogleOauth as false", () => {
    const policy = {
      allowGoogleOauth: false,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowGoogleOauth).toBe(false);
  });

  it("rejects allowGoogleOauth when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowGoogleOauth: true,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "allowGoogleOauth cannot be set when useNonEmailIdentifier is true",
    );
  });

  it("accepts allowGoogleOauth false when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowGoogleOauth: false,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  it("accepts allowGoogleOauth when useNonEmailIdentifier is false", () => {
    const policy = {
      useNonEmailIdentifier: false,
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowGoogleOauth).toBe(true);
  });

  it("rejects allowGoogleOauth when allowedEmailDomains is not set", () => {
    const policy = {
      allowGoogleOauth: true,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "allowGoogleOauth requires allowedEmailDomains to be set",
    );
  });

  it("rejects allowGoogleOauth when allowedEmailDomains is empty", () => {
    const policy = {
      allowGoogleOauth: true,
      allowedEmailDomains: [],
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "allowGoogleOauth requires allowedEmailDomains to be set",
    );
  });

  it("accepts disablePasswordAuth as true when allowGoogleOauth is true", () => {
    const policy = {
      disablePasswordAuth: true,
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.disablePasswordAuth).toBe(true);
  });

  it("accepts disablePasswordAuth as false", () => {
    const policy = {
      disablePasswordAuth: false,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.disablePasswordAuth).toBe(false);
  });

  it("rejects disablePasswordAuth when allowGoogleOauth is not set", () => {
    const policy = {
      disablePasswordAuth: true,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "disablePasswordAuth requires allowGoogleOauth to be enabled",
    );
  });

  it("rejects disablePasswordAuth when allowGoogleOauth is false", () => {
    const policy = {
      disablePasswordAuth: true,
      allowGoogleOauth: false,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "disablePasswordAuth requires allowGoogleOauth to be enabled",
    );
  });

  it("accepts disablePasswordAuth as false when allowGoogleOauth is false", () => {
    const policy = {
      disablePasswordAuth: false,
      allowGoogleOauth: false,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  it("rejects disablePasswordAuth when allowSelfPasswordReset is true", () => {
    const policy = {
      disablePasswordAuth: true,
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
      allowSelfPasswordReset: true,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "disablePasswordAuth cannot be used with allowSelfPasswordReset",
    );
  });

  it("accepts disablePasswordAuth when allowSelfPasswordReset is false", () => {
    const policy = {
      disablePasswordAuth: true,
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
      allowSelfPasswordReset: false,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.disablePasswordAuth).toBe(true);
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

describe("IdPSchema validation", () => {
  it("accepts publishUserEvents as true", () => {
    const config = {
      name: "test-idp",
      authorization: "loggedIn" as const,
      clients: ["client-1"],
      publishUserEvents: true,
    };

    const result = IdPSchema.parse(config);
    expect(result.publishUserEvents).toBe(true);
  });

  it("accepts publishUserEvents as false", () => {
    const config = {
      name: "test-idp",
      authorization: "loggedIn" as const,
      clients: ["client-1"],
      publishUserEvents: false,
    };

    const result = IdPSchema.parse(config);
    expect(result.publishUserEvents).toBe(false);
  });

  it("accepts missing publishUserEvents", () => {
    const config = {
      name: "test-idp",
      authorization: "loggedIn" as const,
      clients: ["client-1"],
    };

    const result = IdPSchema.parse(config);
    expect(result.publishUserEvents).toBeUndefined();
  });

  it("accepts gqlOperations with all fields", () => {
    const config = {
      name: "test-idp",
      authorization: "loggedIn" as const,
      clients: ["client-1"],
      gqlOperations: {
        create: true,
        update: true,
        delete: true,
        read: true,
        sendPasswordResetEmail: true,
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.gqlOperations?.create).toBe(true);
    expect(result.gqlOperations?.update).toBe(true);
    expect(result.gqlOperations?.delete).toBe(true);
    expect(result.gqlOperations?.read).toBe(true);
    expect(result.gqlOperations?.sendPasswordResetEmail).toBe(true);
  });

  it("accepts gqlOperations with partial fields", () => {
    const config = {
      name: "test-idp",
      authorization: "loggedIn" as const,
      clients: ["client-1"],
      gqlOperations: {
        create: true,
        read: false,
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.gqlOperations?.create).toBe(true);
    expect(result.gqlOperations?.read).toBe(false);
    expect(result.gqlOperations?.update).toBeUndefined();
    expect(result.gqlOperations?.delete).toBeUndefined();
    expect(result.gqlOperations?.sendPasswordResetEmail).toBeUndefined();
  });

  it("accepts missing gqlOperations", () => {
    const config = {
      name: "test-idp",
      authorization: "loggedIn" as const,
      clients: ["client-1"],
    };

    const result = IdPSchema.parse(config);
    expect(result.gqlOperations).toBeUndefined();
  });
});

describe("IdPGqlOperationsSchema validation", () => {
  it("accepts empty object", () => {
    const result = IdPGqlOperationsSchema.parse({});
    expect(result.create).toBeUndefined();
    expect(result.update).toBeUndefined();
    expect(result.delete).toBeUndefined();
    expect(result.read).toBeUndefined();
    expect(result.sendPasswordResetEmail).toBeUndefined();
  });

  it("accepts all fields as true", () => {
    const config = {
      create: true,
      update: true,
      delete: true,
      read: true,
      sendPasswordResetEmail: true,
    };

    const result = IdPGqlOperationsSchema.parse(config);
    expect(result.create).toBe(true);
    expect(result.update).toBe(true);
    expect(result.delete).toBe(true);
    expect(result.read).toBe(true);
    expect(result.sendPasswordResetEmail).toBe(true);
  });

  it("accepts all fields as false", () => {
    const config = {
      create: false,
      update: false,
      delete: false,
      read: false,
      sendPasswordResetEmail: false,
    };

    const result = IdPGqlOperationsSchema.parse(config);
    expect(result.create).toBe(false);
    expect(result.update).toBe(false);
    expect(result.delete).toBe(false);
    expect(result.read).toBe(false);
    expect(result.sendPasswordResetEmail).toBe(false);
  });

  it("accepts partial configuration", () => {
    const config = {
      create: true,
      read: false,
    };

    const result = IdPGqlOperationsSchema.parse(config);
    expect(result.create).toBe(true);
    expect(result.read).toBe(false);
    expect(result.update).toBeUndefined();
    expect(result.delete).toBeUndefined();
    expect(result.sendPasswordResetEmail).toBeUndefined();
  });
});
