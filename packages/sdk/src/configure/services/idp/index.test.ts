import { describe, expect, test } from "vitest";
import { defineIdp } from "./index";

describe("defineIdp", () => {
  test("should infer literal types for clients", () => {
    const idp = defineIdp("my-idp", {
      authorization: "loggedIn",
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
      authorization: "loggedIn",
      clients: ["only-client"] as const,
    });

    const provider = idp.provider("provider-name", "only-client");
    expect(provider.clientName).toBe("only-client");
  });

  test("should preserve authorization config", () => {
    const idp1 = defineIdp("idp-1", {
      authorization: "insecure",
      clients: ["client-1"] as const,
    });
    expect(idp1.authorization).toBe("insecure");

    const idp2 = defineIdp("idp-2", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
    });
    expect(idp2.authorization).toBe("loggedIn");

    const idp3 = defineIdp("idp-3", {
      authorization: { cel: 'user.id == "test"' },
      clients: ["client-1"] as const,
    });
    expect(idp3.authorization).toEqual({ cel: 'user.id == "test"' });
  });

  test("should preserve lang config", () => {
    const idpEn = defineIdp("idp-en", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      lang: "en",
    });
    expect(idpEn.lang).toBe("en");

    const idpJa = defineIdp("idp-ja", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      lang: "ja",
    });
    expect(idpJa.lang).toBe("ja");

    const idpNoLang = defineIdp("idp-no-lang", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
    });
    expect(idpNoLang.lang).toBeUndefined();
  });

  test("should preserve userAuthPolicy config", () => {
    const idpWithPolicy = defineIdp("idp-with-policy", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        useNonEmailIdentifier: true,
        allowSelfPasswordReset: true,
      },
    });
    expect(idpWithPolicy.userAuthPolicy?.useNonEmailIdentifier).toBe(true);
    expect(idpWithPolicy.userAuthPolicy?.allowSelfPasswordReset).toBe(true);

    const idpWithPartialPolicy = defineIdp("idp-with-partial-policy", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        allowSelfPasswordReset: false,
      },
    });
    expect(idpWithPartialPolicy.userAuthPolicy?.useNonEmailIdentifier).toBeUndefined();
    expect(idpWithPartialPolicy.userAuthPolicy?.allowSelfPasswordReset).toBe(false);

    const idpNoPolicy = defineIdp("idp-no-policy", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
    });
    expect(idpNoPolicy.userAuthPolicy).toBeUndefined();
  });

  test("should preserve userAuthPolicy password policy fields", () => {
    const idpWithPasswordPolicy = defineIdp("idp-with-password-policy", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
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

    const idpWithPartialPasswordPolicy = defineIdp("idp-with-partial-password-policy", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        passwordRequireUppercase: true,
        passwordMinLength: 8,
      },
    });
    expect(idpWithPartialPasswordPolicy.userAuthPolicy?.passwordRequireUppercase).toBe(true);
    expect(idpWithPartialPasswordPolicy.userAuthPolicy?.passwordMinLength).toBe(8);
    expect(idpWithPartialPasswordPolicy.userAuthPolicy?.passwordRequireLowercase).toBeUndefined();
  });

  test("should preserve userAuthPolicy allowedEmailDomains", () => {
    const idpWithAllowedEmailDomains = defineIdp("idp-with-allowed-email-domains", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        allowedEmailDomains: ["example.com", "corp.example.com"],
      },
    });
    expect(idpWithAllowedEmailDomains.userAuthPolicy?.allowedEmailDomains).toEqual([
      "example.com",
      "corp.example.com",
    ]);

    const idpWithEmptyAllowedEmailDomains = defineIdp("idp-with-empty-allowed-email-domains", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        allowedEmailDomains: [],
      },
    });
    expect(idpWithEmptyAllowedEmailDomains.userAuthPolicy?.allowedEmailDomains).toEqual([]);

    const idpNoAllowedEmailDomains = defineIdp("idp-no-allowed-email-domains", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {},
    });
    expect(idpNoAllowedEmailDomains.userAuthPolicy?.allowedEmailDomains).toBeUndefined();
  });

  test("should preserve userAuthPolicy allowGoogleOauth", () => {
    const idpWithAllowGoogleOauth = defineIdp("idp-with-allow-google-oauth", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        allowGoogleOauth: true,
      },
    });
    expect(idpWithAllowGoogleOauth.userAuthPolicy?.allowGoogleOauth).toBe(true);

    const idpWithAllowGoogleOauthFalse = defineIdp("idp-with-allow-google-oauth-false", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        allowGoogleOauth: false,
      },
    });
    expect(idpWithAllowGoogleOauthFalse.userAuthPolicy?.allowGoogleOauth).toBe(false);

    const idpNoAllowGoogleOauth = defineIdp("idp-no-allow-google-oauth", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {},
    });
    expect(idpNoAllowGoogleOauth.userAuthPolicy?.allowGoogleOauth).toBeUndefined();
  });

  test("should preserve userAuthPolicy allowMicrosoftOauth", () => {
    const idpWithAllowMicrosoftOauth = defineIdp("idp-with-allow-microsoft-oauth", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        allowMicrosoftOauth: true,
      },
    });
    expect(idpWithAllowMicrosoftOauth.userAuthPolicy?.allowMicrosoftOauth).toBe(true);

    const idpWithAllowMicrosoftOauthFalse = defineIdp("idp-with-allow-microsoft-oauth-false", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        allowMicrosoftOauth: false,
      },
    });
    expect(idpWithAllowMicrosoftOauthFalse.userAuthPolicy?.allowMicrosoftOauth).toBe(false);

    const idpNoAllowMicrosoftOauth = defineIdp("idp-no-allow-microsoft-oauth", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {},
    });
    expect(idpNoAllowMicrosoftOauth.userAuthPolicy?.allowMicrosoftOauth).toBeUndefined();
  });

  test("should preserve userAuthPolicy disablePasswordAuth", () => {
    const idpWithDisablePasswordAuth = defineIdp("idp-with-disable-password-auth", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        disablePasswordAuth: true,
        allowGoogleOauth: true,
        allowedEmailDomains: ["example.com"],
      },
    });
    expect(idpWithDisablePasswordAuth.userAuthPolicy?.disablePasswordAuth).toBe(true);

    const idpWithDisablePasswordAuthFalse = defineIdp("idp-with-disable-password-auth-false", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {
        disablePasswordAuth: false,
      },
    });
    expect(idpWithDisablePasswordAuthFalse.userAuthPolicy?.disablePasswordAuth).toBe(false);

    const idpNoDisablePasswordAuth = defineIdp("idp-no-disable-password-auth", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {},
    });
    expect(idpNoDisablePasswordAuth.userAuthPolicy?.disablePasswordAuth).toBeUndefined();
  });

  test("should validate password length ranges", () => {
    // Valid ranges
    expect(() =>
      defineIdp("idp-valid-min", {
        authorization: "loggedIn",
        clients: ["client-1"] as const,
        userAuthPolicy: {
          passwordMinLength: 6,
        },
      }),
    ).not.toThrow();

    expect(() =>
      defineIdp("idp-valid-max", {
        authorization: "loggedIn",
        clients: ["client-1"] as const,
        userAuthPolicy: {
          passwordMaxLength: 4096,
        },
      }),
    ).not.toThrow();

    expect(() =>
      defineIdp("idp-valid-length-consistency", {
        authorization: "loggedIn",
        clients: ["client-1"] as const,
        userAuthPolicy: {
          passwordMinLength: 10,
          passwordMaxLength: 20,
        },
      }),
    ).not.toThrow();

    // Invalid ranges should throw during parsing
    // Note: These tests verify the schema validation works,
    // but defineIdp itself doesn't validate - validation happens in parser layer
  });

  test("should preserve publishUserEvents config", () => {
    const idpWithPublishUserEvents = defineIdp("idp-with-publish-user-events", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      publishUserEvents: true,
    });
    expect(idpWithPublishUserEvents.publishUserEvents).toBe(true);

    const idpWithPublishUserEventsFalse = defineIdp("idp-with-publish-user-events-false", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      publishUserEvents: false,
    });
    expect(idpWithPublishUserEventsFalse.publishUserEvents).toBe(false);

    const idpNoPublishUserEvents = defineIdp("idp-no-publish-user-events", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
    });
    expect(idpNoPublishUserEvents.publishUserEvents).toBeUndefined();
  });

  test("should preserve gqlOperations config", () => {
    const idpWithGqlOperations = defineIdp("idp-with-gql-operations", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      gqlOperations: {
        create: false,
        update: false,
        delete: false,
        read: false,
        sendPasswordResetEmail: false,
      },
    });
    expect(idpWithGqlOperations.gqlOperations).toEqual({
      create: false,
      update: false,
      delete: false,
      read: false,
      sendPasswordResetEmail: false,
    });

    const idpWithPartialGqlOperations = defineIdp("idp-with-partial-gql-operations", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      gqlOperations: {
        create: false,
        read: true,
      },
    });
    expect(idpWithPartialGqlOperations.gqlOperations).toEqual({
      create: false,
      read: true,
    });

    const idpNoGqlOperations = defineIdp("idp-no-gql-operations", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
    });
    expect(idpNoGqlOperations.gqlOperations).toBeUndefined();
  });

  test("gqlOperations: 'query' stores alias as raw value", () => {
    const idpWithQueryAlias = defineIdp("idp-with-query-alias", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      gqlOperations: "query",
    });

    // Configure layer stores the alias without normalization
    expect(idpWithQueryAlias.gqlOperations).toBe("query");
  });

  test("should preserve emailConfig", () => {
    const idpWithEmailConfig = defineIdp("idp-with-email-config", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      emailConfig: {
        fromName: "My App",
        passwordResetSubject: "Reset your password",
      },
    });
    expect(idpWithEmailConfig.emailConfig).toEqual({
      fromName: "My App",
      passwordResetSubject: "Reset your password",
    });

    const idpWithPartialEmailConfig = defineIdp("idp-with-partial-email-config", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      emailConfig: {
        fromName: "My App",
      },
    });
    expect(idpWithPartialEmailConfig.emailConfig).toEqual({
      fromName: "My App",
    });

    const idpNoEmailConfig = defineIdp("idp-no-email-config", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
    });
    expect(idpNoEmailConfig.emailConfig).toBeUndefined();
  });

  test("should preserve userAuthPolicy MFA fields", () => {
    const idpWithMfa = defineIdp("idp-with-mfa", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
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

    const idpNoMfa = defineIdp("idp-no-mfa", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      userAuthPolicy: {},
    });
    expect(idpNoMfa.userAuthPolicy?.enableMfa).toBeUndefined();
    expect(idpNoMfa.userAuthPolicy?.requireMfa).toBeUndefined();
    expect(idpNoMfa.userAuthPolicy?.allowedReturnOrigins).toBeUndefined();
    expect(idpNoMfa.userAuthPolicy?.mfaIssuer).toBeUndefined();
  });

  test("gqlOperations: 'query' works with other config options", () => {
    const idpWithQueryAndOtherOptions = defineIdp("idp-with-query-and-options", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
      lang: "en",
      publishUserEvents: true,
      gqlOperations: "query",
    });

    expect(idpWithQueryAndOtherOptions.lang).toBe("en");
    expect(idpWithQueryAndOtherOptions.publishUserEvents).toBe(true);
    expect(idpWithQueryAndOtherOptions.gqlOperations).toBe("query");
  });
});
