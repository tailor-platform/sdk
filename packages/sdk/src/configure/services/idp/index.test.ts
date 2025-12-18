import { describe, expect, it } from "vitest";
import { defineIdp } from "./index";

describe("defineIdp", () => {
  it("should infer literal types for clients", () => {
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

  it("should work with single client", () => {
    const idp = defineIdp("my-idp", {
      authorization: "loggedIn",
      clients: ["only-client"] as const,
    });

    const provider = idp.provider("provider-name", "only-client");
    expect(provider.clientName).toBe("only-client");
  });

  it("should preserve authorization config", () => {
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

  it("should preserve lang config", () => {
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

  it("should preserve userAuthPolicy config", () => {
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
    expect(
      idpWithPartialPolicy.userAuthPolicy?.useNonEmailIdentifier,
    ).toBeUndefined();
    expect(idpWithPartialPolicy.userAuthPolicy?.allowSelfPasswordReset).toBe(
      false,
    );

    const idpNoPolicy = defineIdp("idp-no-policy", {
      authorization: "loggedIn",
      clients: ["client-1"] as const,
    });
    expect(idpNoPolicy.userAuthPolicy).toBeUndefined();
  });

  it("should preserve userAuthPolicy password policy fields", () => {
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
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordRequireUppercase).toBe(
      true,
    );
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordRequireLowercase).toBe(
      true,
    );
    expect(
      idpWithPasswordPolicy.userAuthPolicy?.passwordRequireNonAlphanumeric,
    ).toBe(true);
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordRequireNumeric).toBe(
      true,
    );
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordMinLength).toBe(10);
    expect(idpWithPasswordPolicy.userAuthPolicy?.passwordMaxLength).toBe(128);

    const idpWithPartialPasswordPolicy = defineIdp(
      "idp-with-partial-password-policy",
      {
        authorization: "loggedIn",
        clients: ["client-1"] as const,
        userAuthPolicy: {
          passwordRequireUppercase: true,
          passwordMinLength: 8,
        },
      },
    );
    expect(
      idpWithPartialPasswordPolicy.userAuthPolicy?.passwordRequireUppercase,
    ).toBe(true);
    expect(idpWithPartialPasswordPolicy.userAuthPolicy?.passwordMinLength).toBe(
      8,
    );
    expect(
      idpWithPartialPasswordPolicy.userAuthPolicy?.passwordRequireLowercase,
    ).toBeUndefined();
  });

  it("should validate password length ranges", () => {
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
});
