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
});
