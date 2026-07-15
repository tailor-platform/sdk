import { describe, expect, test } from "vitest";
import { defineIdp, unsafeAllowAllIdPPermission } from "./index";

let idpCounter = 0;
function makeIdp<Config extends Record<string, unknown>>(config: Config) {
  return defineIdp(`idp-${idpCounter++}`, {
    permission: unsafeAllowAllIdPPermission,
    clients: ["client-1"] as const,
    ...config,
  });
}

describe("defineIdp", () => {
  test("should infer literal types for clients", () => {
    const idp = defineIdp("my-idp", {
      permission: unsafeAllowAllIdPPermission,
      clients: ["client-1", "client-2"] as const,
    });

    // Type test: these should be valid
    const provider1 = idp.provider("provider-name", "client-1");
    const provider2 = idp.provider("provider-name", "client-2");

    expect(provider1.clientName).toBe("client-1");
    expect(provider2.clientName).toBe("client-2");
  });

  test("should work with single client", () => {
    const idp = defineIdp("my-idp", {
      permission: unsafeAllowAllIdPPermission,
      clients: ["only-client"] as const,
    });

    const provider = idp.provider("provider-name", "only-client");
    expect(provider.clientName).toBe("only-client");
  });

  test("should preserve permission config", () => {
    const idp = makeIdp({});
    expect(idp.permission).toEqual(unsafeAllowAllIdPPermission);
  });

  test.each([
    ["en", "en"],
    ["ja", "ja"],
    [undefined, undefined],
  ] as const)("should preserve lang config (%s)", (lang, expected) => {
    const idp = makeIdp(lang === undefined ? {} : { lang });
    expect(idp.lang).toBe(expected);
  });

  test("should preserve userAuthPolicy config", () => {
    const idpWithPolicy = makeIdp({
      userAuthPolicy: { useNonEmailIdentifier: true, allowSelfPasswordReset: true },
    });
    expect(idpWithPolicy.userAuthPolicy?.useNonEmailIdentifier).toBe(true);
    expect(idpWithPolicy.userAuthPolicy?.allowSelfPasswordReset).toBe(true);

    const idpWithPartialPolicy = makeIdp({
      userAuthPolicy: { allowSelfPasswordReset: false },
    });
    expect(idpWithPartialPolicy.userAuthPolicy?.useNonEmailIdentifier).toBeUndefined();
    expect(idpWithPartialPolicy.userAuthPolicy?.allowSelfPasswordReset).toBe(false);

    const idpNoPolicy = makeIdp({});
    expect(idpNoPolicy.userAuthPolicy).toBeUndefined();
  });

  test("should preserve userAuthPolicy password policy fields", () => {
    const idpWithPasswordPolicy = makeIdp({
      userAuthPolicy: {
        passwordRequireUppercase: true,
        passwordRequireLowercase: true,
        passwordRequireNonAlphanumeric: true,
        passwordRequireNumeric: true,
        passwordMinLength: 10,
        passwordMaxLength: 128,
      },
    });
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordRequireUppercase).toBe(true);
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordRequireLowercase).toBe(true);
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordRequireNonAlphanumeric).toBe(true);
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordRequireNumeric).toBe(true);
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordMinLength).toBe(10);
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordMaxLength).toBe(128);

    const idpWithPartialPasswordPolicy = makeIdp({
      userAuthPolicy: { passwordRequireUppercase: true, passwordMinLength: 8 },
    });
    expect(idpWithPartialPasswordPolicy.userAuthPolicy?.passwordRequireUppercase).toBe(true);
    expect(idpWithPartialPasswordPolicy.userAuthPolicy?.passwordMinLength).toBe(8);
    expect(idpWithPartialPasswordPolicy.userAuthPolicy?.passwordRequireLowercase).toBeUndefined();
  });

  test("should preserve userAuthPolicy allowedEmailDomains", () => {
    const idpWithAllowedEmailDomains = makeIdp({
      userAuthPolicy: { allowedEmailDomains: ["example.com", "corp.example.com"] },
    });
    expect(idpWithAllowedEmailDomains.userAuthPolicy?.allowedEmailDomains).toEqual([
      "example.com",
      "corp.example.com",
    ]);

    const idpWithEmptyAllowedEmailDomains = makeIdp({
      userAuthPolicy: { allowedEmailDomains: [] },
    });
    expect(idpWithEmptyAllowedEmailDomains.userAuthPolicy?.allowedEmailDomains).toEqual([]);

    const idpNoAllowedEmailDomains = makeIdp({ userAuthPolicy: {} });
    expect(idpNoAllowedEmailDomains.userAuthPolicy?.allowedEmailDomains).toBeUndefined();
  });

  test.each([
    [true, true],
    [false, false],
    [undefined, undefined],
  ] as const)("should preserve userAuthPolicy allowGoogleOauth (%s)", (value, expected) => {
    const idp = makeIdp({
      userAuthPolicy: value === undefined ? {} : { allowGoogleOauth: value },
    });
    expect(idp.userAuthPolicy?.allowGoogleOauth).toBe(expected);
  });

  test.each([
    [true, true],
    [false, false],
    [undefined, undefined],
  ] as const)("should preserve userAuthPolicy allowMicrosoftOauth (%s)", (value, expected) => {
    const idp = makeIdp({
      userAuthPolicy: value === undefined ? {} : { allowMicrosoftOauth: value },
    });
    expect(idp.userAuthPolicy?.allowMicrosoftOauth).toBe(expected);
  });

  test("should preserve userAuthPolicy disablePasswordAuth", () => {
    const idpWithDisablePasswordAuth = makeIdp({
      userAuthPolicy: {
        disablePasswordAuth: true,
        allowGoogleOauth: true,
        allowedEmailDomains: ["example.com"],
      },
    });
    expect(idpWithDisablePasswordAuth.userAuthPolicy?.disablePasswordAuth).toBe(true);

    const idpWithDisablePasswordAuthFalse = makeIdp({
      userAuthPolicy: { disablePasswordAuth: false },
    });
    expect(idpWithDisablePasswordAuthFalse.userAuthPolicy?.disablePasswordAuth).toBe(false);

    const idpNoDisablePasswordAuth = makeIdp({ userAuthPolicy: {} });
    expect(idpNoDisablePasswordAuth.userAuthPolicy?.disablePasswordAuth).toBeUndefined();
  });

  test("should validate password length ranges", () => {
    expect(() => makeIdp({ userAuthPolicy: { passwordMinLength: 6 } })).not.toThrow();
    expect(() => makeIdp({ userAuthPolicy: { passwordMaxLength: 4096 } })).not.toThrow();
    expect(() =>
      makeIdp({ userAuthPolicy: { passwordMinLength: 10, passwordMaxLength: 20 } }),
    ).not.toThrow();

    // Invalid ranges should throw during parsing.
    // defineIdp itself doesn't validate - validation happens in parser layer.
  });

  test.each([
    [true, true],
    [false, false],
    [undefined, undefined],
  ] as const)("should preserve publishUserEvents config (%s)", (value, expected) => {
    const idp = makeIdp(value === undefined ? {} : { publishUserEvents: value });
    expect(idp.publishUserEvents).toBe(expected);
  });

  test("should preserve gqlOperations config", () => {
    const fullOps = {
      create: false,
      update: false,
      delete: false,
      read: false,
      sendPasswordResetEmail: false,
    };
    const idpWithGqlOperations = makeIdp({ gqlOperations: fullOps });
    expect(idpWithGqlOperations.gqlOperations).toEqual(fullOps);

    const partialOps = { create: false, read: true };
    const idpWithPartialGqlOperations = makeIdp({ gqlOperations: partialOps });
    expect(idpWithPartialGqlOperations.gqlOperations).toEqual(partialOps);

    const idpNoGqlOperations = makeIdp({});
    expect(idpNoGqlOperations.gqlOperations).toBeUndefined();
  });

  test("gqlOperations: 'query' stores alias as raw value", () => {
    const idpWithQueryAlias = makeIdp({ gqlOperations: "query" });

    // Configure layer stores the alias without normalization
    expect(idpWithQueryAlias.gqlOperations).toBe("query");
  });

  test("should preserve emailConfig", () => {
    const idpWithEmailConfig = makeIdp({
      emailConfig: { fromName: "My App", passwordResetSubject: "Reset your password" },
    });
    expect(idpWithEmailConfig.emailConfig).toEqual({
      fromName: "My App",
      passwordResetSubject: "Reset your password",
    });

    const idpWithPartialEmailConfig = makeIdp({ emailConfig: { fromName: "My App" } });
    expect(idpWithPartialEmailConfig.emailConfig).toEqual({ fromName: "My App" });

    const idpNoEmailConfig = makeIdp({});
    expect(idpNoEmailConfig.emailConfig).toBeUndefined();
  });

  test("should preserve userAuthPolicy MFA fields", () => {
    const idpWithMfa = makeIdp({
      userAuthPolicy: {
        enableMfa: true,
        requireMfa: true,
        allowedReturnOrigins: ["https://app.example.com", "http://localhost:3000"],
        mfaIssuer: "My App",
      },
    });
    expect(idpWithMfa.userAuthPolicy?.enableMfa).toBe(true);
    expect(idpWithMfa.userAuthPolicy?.requireMfa).toBe(true);
    expect(idpWithMfa.userAuthPolicy?.allowedReturnOrigins).toEqual([
      "https://app.example.com",
      "http://localhost:3000",
    ]);
    expect(idpWithMfa.userAuthPolicy?.mfaIssuer).toBe("My App");

    const idpNoMfa = makeIdp({ userAuthPolicy: {} });
    expect(idpNoMfa.userAuthPolicy?.enableMfa).toBeUndefined();
    expect(idpNoMfa.userAuthPolicy?.requireMfa).toBeUndefined();
    expect(idpNoMfa.userAuthPolicy?.allowedReturnOrigins).toBeUndefined();
    expect(idpNoMfa.userAuthPolicy?.mfaIssuer).toBeUndefined();
  });

  test("gqlOperations: 'query' works with other config options", () => {
    const idpWithQueryAndOtherOptions = makeIdp({
      lang: "en",
      publishUserEvents: true,
      gqlOperations: "query",
    });

    expect(idpWithQueryAndOtherOptions.lang).toBe("en");
    expect(idpWithQueryAndOtherOptions.publishUserEvents).toBe(true);
    expect(idpWithQueryAndOtherOptions.gqlOperations).toBe("query");
  });
});
