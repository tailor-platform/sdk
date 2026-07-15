import { describe, expect, test } from "vitest";
import {
  IdPUserAuthPolicySchema,
  IdPSchema,
  IdPGqlOperationsSchema,
  IdPEmailConfigSchema,
} from "./schema";

const TEST_PERMISSION = {
  create: [],
  read: [],
  update: [],
  delete: [],
  sendPasswordResetEmail: [],
};

describe("IdPUserAuthPolicySchema validation", () => {
  test.each([
    [
      "valid password policy configuration",
      {
        passwordRequireUppercase: true,
        passwordRequireLowercase: true,
        passwordRequireNonAlphanumeric: true,
        passwordRequireNumeric: true,
        passwordMinLength: 10,
        passwordMaxLength: 20,
      },
    ],
    ["minimum password length", { passwordMinLength: 6 }],
    ["maximum password length", { passwordMaxLength: 4096 }],
  ])("accepts %s", (_name, policy) => {
    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  test.each([
    [
      "passwordMinLength below minimum (5)",
      { passwordMinLength: 5 },
      "passwordMinLength must be between 6 and 30",
    ],
    [
      "passwordMinLength above maximum (31)",
      { passwordMinLength: 31 },
      "passwordMinLength must be between 6 and 30",
    ],
    [
      "passwordMaxLength below minimum (5)",
      { passwordMaxLength: 5 },
      "passwordMaxLength must be between 6 and 4096",
    ],
    [
      "passwordMaxLength above maximum (4097)",
      { passwordMaxLength: 4097 },
      "passwordMaxLength must be between 6 and 4096",
    ],
    [
      "when passwordMinLength > passwordMaxLength",
      { passwordMinLength: 20, passwordMaxLength: 10 },
      "passwordMinLength must be less than or equal to passwordMaxLength",
    ],
  ])("rejects %s", (_name, policy, message) => {
    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(message);
  });

  test("accepts when passwordMinLength equals passwordMaxLength", () => {
    const policy = {
      passwordMinLength: 10,
      passwordMaxLength: 10,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  test("returns undefined for unspecified fields (allows platform defaults)", () => {
    const result = IdPUserAuthPolicySchema.parse({});
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
    expect(result.allowMicrosoftOauth).toBeUndefined();
    expect(result.disablePasswordAuth).toBeUndefined();
  });

  test.each([
    [[], []],
    [["example.com"], ["example.com"]],
    [
      ["example.com", "corp.example.com", "test.org"],
      ["example.com", "corp.example.com", "test.org"],
    ],
  ])("accepts allowedEmailDomains %j", (allowedEmailDomains, expected) => {
    const result = IdPUserAuthPolicySchema.parse({ allowedEmailDomains });
    expect(result.allowedEmailDomains).toEqual(expected);
  });

  test("rejects allowedEmailDomains when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowedEmailDomains: ["example.com"],
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "allowedEmailDomains cannot be set when useNonEmailIdentifier is true",
    );
  });

  test("accepts empty allowedEmailDomains when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowedEmailDomains: [],
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  test("accepts allowedEmailDomains when useNonEmailIdentifier is false", () => {
    const policy = {
      useNonEmailIdentifier: false,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowedEmailDomains).toEqual(["example.com"]);
  });

  test("accepts allowGoogleOauth as true with allowedEmailDomains", () => {
    const policy = {
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowGoogleOauth).toBe(true);
  });

  test("accepts allowGoogleOauth as false", () => {
    const policy = {
      allowGoogleOauth: false,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowGoogleOauth).toBe(false);
  });

  test("rejects allowGoogleOauth when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowGoogleOauth: true,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "allowGoogleOauth cannot be set when useNonEmailIdentifier is true",
    );
  });

  test("accepts allowGoogleOauth false when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowGoogleOauth: false,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  test("accepts allowGoogleOauth when useNonEmailIdentifier is false", () => {
    const policy = {
      useNonEmailIdentifier: false,
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowGoogleOauth).toBe(true);
  });

  test.each([[undefined], [[]]])(
    "rejects allowGoogleOauth when allowedEmailDomains is %s",
    (allowedEmailDomains) => {
      const policy = {
        allowGoogleOauth: true,
        ...(allowedEmailDomains !== undefined && { allowedEmailDomains }),
      };

      expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
        "allowGoogleOauth requires allowedEmailDomains to be set",
      );
    },
  );

  test("accepts allowMicrosoftOauth as true with allowedEmailDomains and disablePasswordAuth", () => {
    const policy = {
      allowMicrosoftOauth: true,
      allowedEmailDomains: ["example.com"],
      disablePasswordAuth: true,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowMicrosoftOauth).toBe(true);
  });

  test("accepts allowMicrosoftOauth as false", () => {
    const policy = {
      allowMicrosoftOauth: false,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowMicrosoftOauth).toBe(false);
  });

  test("rejects allowMicrosoftOauth when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowMicrosoftOauth: true,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "allowMicrosoftOauth cannot be set when useNonEmailIdentifier is true",
    );
  });

  test("accepts allowMicrosoftOauth false when useNonEmailIdentifier is true", () => {
    const policy = {
      useNonEmailIdentifier: true,
      allowMicrosoftOauth: false,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  test("accepts allowMicrosoftOauth when useNonEmailIdentifier is false", () => {
    const policy = {
      useNonEmailIdentifier: false,
      allowMicrosoftOauth: true,
      allowedEmailDomains: ["example.com"],
      disablePasswordAuth: true,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowMicrosoftOauth).toBe(true);
  });

  test.each([
    [
      "disablePasswordAuth is not set",
      { allowMicrosoftOauth: true, allowedEmailDomains: ["example.com"] },
      "allowMicrosoftOauth requires disablePasswordAuth to be enabled",
    ],
    [
      "disablePasswordAuth is false",
      {
        allowMicrosoftOauth: true,
        allowedEmailDomains: ["example.com"],
        disablePasswordAuth: false,
      },
      "allowMicrosoftOauth requires disablePasswordAuth to be enabled",
    ],
    [
      "allowedEmailDomains is not set",
      { allowMicrosoftOauth: true },
      "allowMicrosoftOauth requires allowedEmailDomains to be set",
    ],
    [
      "allowedEmailDomains is empty",
      { allowMicrosoftOauth: true, allowedEmailDomains: [] },
      "allowMicrosoftOauth requires allowedEmailDomains to be set",
    ],
  ])("rejects allowMicrosoftOauth when %s", (_name, policy, message) => {
    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(message);
  });

  test("accepts disablePasswordAuth as true when allowGoogleOauth is true", () => {
    const policy = {
      disablePasswordAuth: true,
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.disablePasswordAuth).toBe(true);
  });

  test("accepts disablePasswordAuth as true when allowMicrosoftOauth is true", () => {
    const policy = {
      disablePasswordAuth: true,
      allowMicrosoftOauth: true,
      allowedEmailDomains: ["example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.disablePasswordAuth).toBe(true);
  });

  test("accepts disablePasswordAuth as false", () => {
    const policy = {
      disablePasswordAuth: false,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.disablePasswordAuth).toBe(false);
  });

  test.each([
    ["allowGoogleOauth is not set", { disablePasswordAuth: true }],
    ["allowGoogleOauth is false", { disablePasswordAuth: true, allowGoogleOauth: false }],
  ])("rejects disablePasswordAuth when %s", (_name, policy) => {
    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "disablePasswordAuth requires allowGoogleOauth or allowMicrosoftOauth to be enabled",
    );
  });

  test("accepts disablePasswordAuth as false when allowGoogleOauth is false", () => {
    const policy = {
      disablePasswordAuth: false,
      allowGoogleOauth: false,
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).not.toThrow();
  });

  test("rejects disablePasswordAuth when allowSelfPasswordReset is true", () => {
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

  test("accepts disablePasswordAuth when allowSelfPasswordReset is false", () => {
    const policy = {
      disablePasswordAuth: true,
      allowGoogleOauth: true,
      allowedEmailDomains: ["example.com"],
      allowSelfPasswordReset: false,
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.disablePasswordAuth).toBe(true);
  });

  test("accepts partial password policy configuration", () => {
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

  test("accepts enableMfa with allowedReturnOrigins", () => {
    const policy = {
      enableMfa: true,
      allowedReturnOrigins: ["https://app.example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.enableMfa).toBe(true);
    expect(result.allowedReturnOrigins).toEqual(["https://app.example.com"]);
  });

  test.each([[undefined], [[]]])(
    "rejects enableMfa with allowedReturnOrigins %s",
    (allowedReturnOrigins) => {
      const policy = {
        enableMfa: true,
        ...(allowedReturnOrigins !== undefined && { allowedReturnOrigins }),
      };

      expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
        "enableMfa requires allowedReturnOrigins to list at least one origin",
      );
    },
  );

  test("accepts requireMfa with enableMfa and allowedReturnOrigins", () => {
    const policy = {
      enableMfa: true,
      requireMfa: true,
      allowedReturnOrigins: ["https://app.example.com"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.requireMfa).toBe(true);
  });

  test.each([
    ["without enableMfa", { requireMfa: true }],
    ["when enableMfa is false", { enableMfa: false, requireMfa: true }],
  ])("rejects requireMfa %s", (_name, policy) => {
    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "requireMfa requires enableMfa to be enabled",
    );
  });

  test("accepts allowedReturnOrigins with http origins", () => {
    const policy = {
      enableMfa: true,
      allowedReturnOrigins: ["http://localhost:3000", "https://app.example.com:8443"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowedReturnOrigins).toEqual([
      "http://localhost:3000",
      "https://app.example.com:8443",
    ]);
  });

  test.each([
    ["non-http scheme", "ftp://app.example.com"],
    ["path component", "https://app.example.com/return"],
    ["query string", "https://app.example.com?foo=bar"],
    [":url placeholder followed by a path", "my-frontend:url/return"],
    ["a typo'd literal origin ending in :url", "https://app.example.com:url"],
    [":url placeholder using invalid slug", "My_Frontend:url"],
  ])("rejects allowedReturnOrigins with %s", (_name, origin) => {
    const policy = {
      enableMfa: true,
      allowedReturnOrigins: [origin],
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow("must be an http(s) origin");
  });

  test("accepts allowedReturnOrigins with static-website :url placeholder", () => {
    const policy = {
      enableMfa: true,
      allowedReturnOrigins: ["my-frontend:url"],
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.allowedReturnOrigins).toEqual(["my-frontend:url"]);
  });

  test("accepts mfaIssuer", () => {
    const policy = {
      enableMfa: true,
      allowedReturnOrigins: ["https://app.example.com"],
      mfaIssuer: "My App",
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.mfaIssuer).toBe("My App");
  });

  test("rejects mfaIssuer exceeding 64 characters", () => {
    const policy = {
      enableMfa: true,
      allowedReturnOrigins: ["https://app.example.com"],
      mfaIssuer: "a".repeat(65),
    };

    expect(() => IdPUserAuthPolicySchema.parse(policy)).toThrow(
      "mfaIssuer must be 64 characters or less",
    );
  });

  test("accepts mfaIssuer at exactly 64 characters", () => {
    const policy = {
      enableMfa: true,
      allowedReturnOrigins: ["https://app.example.com"],
      mfaIssuer: "a".repeat(64),
    };

    const result = IdPUserAuthPolicySchema.parse(policy);
    expect(result.mfaIssuer).toHaveLength(64);
  });

  test("MFA fields default to undefined when omitted", () => {
    const result = IdPUserAuthPolicySchema.parse({});
    expect(result.enableMfa).toBeUndefined();
    expect(result.requireMfa).toBeUndefined();
    expect(result.allowedReturnOrigins).toBeUndefined();
    expect(result.mfaIssuer).toBeUndefined();
  });
});

describe("IdPSchema validation", () => {
  test.each([
    [true, true],
    [false, false],
    [undefined, undefined],
  ])("accepts publishUserEvents as %s", (publishUserEvents, expected) => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
      ...(publishUserEvents !== undefined && { publishUserEvents }),
    };

    const result = IdPSchema.parse(config);
    expect(result.publishUserEvents).toBe(expected);
  });

  test("accepts gqlOperations with all fields", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
      gqlOperations: {
        create: true,
        update: true,
        delete: true,
        read: true,
        sendPasswordResetEmail: true,
        requestMfaSettingsUrl: true,
        unenrollMfa: true,
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.gqlOperations?.create).toBe(true);
    expect(result.gqlOperations?.update).toBe(true);
    expect(result.gqlOperations?.delete).toBe(true);
    expect(result.gqlOperations?.read).toBe(true);
    expect(result.gqlOperations?.sendPasswordResetEmail).toBe(true);
    expect(result.gqlOperations?.requestMfaSettingsUrl).toBe(true);
    expect(result.gqlOperations?.unenrollMfa).toBe(true);
  });

  test("accepts gqlOperations with partial fields", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
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
    expect(result.gqlOperations?.requestMfaSettingsUrl).toBeUndefined();
    expect(result.gqlOperations?.unenrollMfa).toBeUndefined();
  });

  test("accepts missing gqlOperations", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
    };

    const result = IdPSchema.parse(config);
    expect(result.gqlOperations).toBeUndefined();
  });
});

describe("IdPGqlOperationsSchema validation", () => {
  test("accepts empty object", () => {
    const result = IdPGqlOperationsSchema.parse({});
    expect(result.create).toBeUndefined();
    expect(result.update).toBeUndefined();
    expect(result.delete).toBeUndefined();
    expect(result.read).toBeUndefined();
    expect(result.sendPasswordResetEmail).toBeUndefined();
    expect(result.requestMfaSettingsUrl).toBeUndefined();
    expect(result.unenrollMfa).toBeUndefined();
  });

  test.each([true, false])("accepts all fields as %s", (value) => {
    const config = {
      create: value,
      update: value,
      delete: value,
      read: value,
      sendPasswordResetEmail: value,
      requestMfaSettingsUrl: value,
      unenrollMfa: value,
    };

    const result = IdPGqlOperationsSchema.parse(config);
    expect(result.create).toBe(value);
    expect(result.update).toBe(value);
    expect(result.delete).toBe(value);
    expect(result.read).toBe(value);
    expect(result.sendPasswordResetEmail).toBe(value);
    expect(result.requestMfaSettingsUrl).toBe(value);
    expect(result.unenrollMfa).toBe(value);
  });

  test("accepts partial configuration", () => {
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
    expect(result.requestMfaSettingsUrl).toBeUndefined();
    expect(result.unenrollMfa).toBeUndefined();
  });

  test("accepts 'query' alias and normalizes to read-only mode", () => {
    const result = IdPGqlOperationsSchema.parse("query");
    expect(result.create).toBe(false);
    expect(result.update).toBe(false);
    expect(result.delete).toBe(false);
    expect(result.read).toBe(true);
    expect(result.sendPasswordResetEmail).toBe(false);
    expect(result.requestMfaSettingsUrl).toBe(true);
    expect(result.unenrollMfa).toBe(false);
  });
});

describe("IdPEmailConfigSchema validation", () => {
  test("accepts valid email config", () => {
    const result = IdPEmailConfigSchema.parse({
      fromName: "My App",
      passwordResetSubject: "Reset your password",
    });
    expect(result.fromName).toBe("My App");
    expect(result.passwordResetSubject).toBe("Reset your password");
  });

  test("accepts partial config", () => {
    const result = IdPEmailConfigSchema.parse({ fromName: "My App" });
    expect(result.fromName).toBe("My App");
    expect(result.passwordResetSubject).toBeUndefined();
  });

  test("accepts empty object", () => {
    const result = IdPEmailConfigSchema.parse({});
    expect(result.fromName).toBeUndefined();
    expect(result.passwordResetSubject).toBeUndefined();
  });

  test.each([
    ["fromName", "fromName" as const],
    ["passwordResetSubject", "passwordResetSubject" as const],
  ])("rejects %s exceeding 200 characters", (_name, field) => {
    expect(() => IdPEmailConfigSchema.parse({ [field]: "a".repeat(201) })).toThrow(
      "200 characters or less",
    );
  });

  test("rejects fromName containing newline characters", () => {
    expect(() => IdPEmailConfigSchema.parse({ fromName: "My\nApp" })).toThrow(
      "must not contain newline characters",
    );
    expect(() => IdPEmailConfigSchema.parse({ fromName: "My\rApp" })).toThrow(
      "must not contain newline characters",
    );
  });

  test("rejects passwordResetSubject containing newline characters", () => {
    expect(() =>
      IdPEmailConfigSchema.parse({ passwordResetSubject: "Reset\nyour password" }),
    ).toThrow("must not contain newline characters");
  });

  test("accepts fromName at exactly 200 characters", () => {
    const result = IdPEmailConfigSchema.parse({ fromName: "a".repeat(200) });
    expect(result.fromName).toHaveLength(200);
  });
});

describe("IdPSchema emailConfig tests", () => {
  test("accepts emailConfig in IdPSchema", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
      emailConfig: {
        fromName: "My App",
        passwordResetSubject: "Reset your password",
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.emailConfig?.fromName).toBe("My App");
    expect(result.emailConfig?.passwordResetSubject).toBe("Reset your password");
  });

  test("accepts missing emailConfig", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
    };

    const result = IdPSchema.parse(config);
    expect(result.emailConfig).toBeUndefined();
  });

  test("rejects invalid emailConfig in IdPSchema", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
      emailConfig: {
        fromName: "a".repeat(201),
      },
    };

    expect(() => IdPSchema.parse(config)).toThrow("200 characters or less");
  });
});

describe("IdPSchema permission tests", () => {
  test("accepts permission with all 5 actions", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      permission: {
        create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
        read: [{ conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true }],
        update: [
          { conditions: [[{ newIdpUser: "name" }, "!=", { oldIdpUser: "name" }]], permit: true },
        ],
        delete: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
        sendPasswordResetEmail: [{ conditions: [], permit: true }],
        unenrollMfa: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.permission).toBeDefined();
    expect(result.permission!.create).toHaveLength(1);
    expect(result.permission!.sendPasswordResetEmail).toHaveLength(1);
  });

  test("accepts missing permission", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
    };

    const result = IdPSchema.parse(config);
    expect(result.permission).toBeUndefined();
  });

  test("accepts permission with empty arrays (deny-all)", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
        sendPasswordResetEmail: [],
        unenrollMfa: [],
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.permission!.create).toHaveLength(0);
  });

  test("accepts permission with array shorthand format", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      permission: {
        create: [[{ user: "role" }, "=", "ADMIN"]],
        read: [[{ user: "role" }, "=", "ADMIN"]],
        update: [[{ user: "role" }, "=", "ADMIN"]],
        delete: [[{ user: "role" }, "=", "ADMIN"]],
        sendPasswordResetEmail: [[{ user: "role" }, "=", "ADMIN"]],
        unenrollMfa: [[{ user: "role" }, "=", "ADMIN"]],
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.permission).toBeDefined();
  });

  test("accepts permission omitting unenrollMfa when enableMfa is not set", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
        sendPasswordResetEmail: [],
      },
    };

    expect(() => IdPSchema.parse(config)).not.toThrow();
  });

  test("rejects permission omitting unenrollMfa when enableMfa is true", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      userAuthPolicy: {
        enableMfa: true,
        allowedReturnOrigins: ["https://app.example.com"],
      },
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
        sendPasswordResetEmail: [],
      },
    };

    expect(() => IdPSchema.parse(config)).toThrow(
      "permission.unenrollMfa must be set explicitly when userAuthPolicy.enableMfa is true",
    );
  });

  test("rejects enableMfa: true when permission is omitted entirely", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      userAuthPolicy: {
        enableMfa: true,
        allowedReturnOrigins: ["https://app.example.com"],
      },
    };

    expect(() => IdPSchema.parse(config)).toThrow(
      "permission.unenrollMfa must be set explicitly when userAuthPolicy.enableMfa is true",
    );
  });

  test.each([
    ["gqlOperations.unenrollMfa is false", { unenrollMfa: false }],
    ["gqlOperations is the 'query' alias", "query" as const],
  ])(
    "accepts permission omitting unenrollMfa when %s and enableMfa is true",
    (_name, gqlOperations) => {
      const config = {
        name: "test-idp",
        clients: ["client-1"],
        userAuthPolicy: {
          enableMfa: true,
          allowedReturnOrigins: ["https://app.example.com"],
        },
        gqlOperations,
        permission: {
          create: [],
          read: [],
          update: [],
          delete: [],
          sendPasswordResetEmail: [],
        },
      };

      expect(() => IdPSchema.parse(config)).not.toThrow();
    },
  );

  test("accepts permission with explicit empty unenrollMfa when enableMfa is true", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      userAuthPolicy: {
        enableMfa: true,
        allowedReturnOrigins: ["https://app.example.com"],
      },
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
        sendPasswordResetEmail: [],
        unenrollMfa: [],
      },
    };

    expect(() => IdPSchema.parse(config)).not.toThrow();
  });

  test("accepts permission with in/not in operators", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      permission: {
        create: [{ conditions: [[{ user: "role" }, "in", ["ADMIN", "MANAGER"]]], permit: true }],
        read: [{ conditions: [[{ user: "role" }, "not in", ["GUEST"]]], permit: true }],
        update: [],
        delete: [],
        sendPasswordResetEmail: [],
        unenrollMfa: [],
      },
    };

    const result = IdPSchema.parse(config);
    expect(result.permission).toBeDefined();
  });

  test("rejects permission omitting sendPasswordResetEmail when password auth is enabled", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
      },
    };

    expect(() => IdPSchema.parse(config)).toThrow(
      "permission.sendPasswordResetEmail must be set explicitly when password authentication is enabled",
    );
  });

  test("accepts permission omitting sendPasswordResetEmail when disablePasswordAuth is true", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      userAuthPolicy: {
        disablePasswordAuth: true,
        allowGoogleOauth: true,
        allowedEmailDomains: ["example.com"],
      },
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
      },
    };

    expect(() => IdPSchema.parse(config)).not.toThrow();
  });

  test("accepts permission with explicit empty sendPasswordResetEmail", () => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
        sendPasswordResetEmail: [],
      },
    };

    expect(() => IdPSchema.parse(config)).not.toThrow();
  });

  test.each([
    ["gqlOperations.sendPasswordResetEmail is false", { sendPasswordResetEmail: false }],
    ["gqlOperations is the 'query' alias", "query" as const],
  ])("accepts permission omitting sendPasswordResetEmail when %s", (_name, gqlOperations) => {
    const config = {
      name: "test-idp",
      clients: ["client-1"],
      gqlOperations,
      permission: {
        create: [],
        read: [],
        update: [],
        delete: [],
      },
    };

    expect(() => IdPSchema.parse(config)).not.toThrow();
  });
});

describe("IdPSchema gqlOperations alias tests", () => {
  test("accepts 'query' alias in IdPSchema", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
      gqlOperations: "query" as const,
    };

    const result = IdPSchema.parse(config);
    expect(result.gqlOperations?.create).toBe(false);
    expect(result.gqlOperations?.update).toBe(false);
    expect(result.gqlOperations?.delete).toBe(false);
    expect(result.gqlOperations?.read).toBe(true);
    expect(result.gqlOperations?.sendPasswordResetEmail).toBe(false);
  });

  test("'query' alias works with other IdP config options", () => {
    const config = {
      name: "test-idp",
      permission: TEST_PERMISSION,
      clients: ["client-1"],
      lang: "en" as const,
      publishUserEvents: true,
      gqlOperations: "query" as const,
    };

    const result = IdPSchema.parse(config);
    expect(result.lang).toBe("en");
    expect(result.publishUserEvents).toBe(true);
    expect(result.gqlOperations?.read).toBe(true);
    expect(result.gqlOperations?.create).toBe(false);
    expect(result.gqlOperations?.requestMfaSettingsUrl).toBe(true);
    expect(result.gqlOperations?.unenrollMfa).toBe(false);
  });
});
