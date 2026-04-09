import { describe, expect, it } from "vitest";
import { processIdpUser } from "./idp-user-processor";
import type { GeneratorAuthInput } from "@/types/plugin-generation";

describe("processIdpUser", () => {
  it("returns undefined when idProvider is not BuiltInIdP", () => {
    const auth: GeneratorAuthInput = {
      name: "main-auth",
      machineUsers: { admin: { attributes: { role: "admin" } } },
    };
    expect(processIdpUser(auth)).toBeUndefined();
  });

  it("returns undefined when idProvider is BuiltInIdP but userProfile is missing", () => {
    const auth: GeneratorAuthInput = {
      name: "main-auth",
      idProvider: {
        name: "my-idp",
        kind: "BuiltInIdP",
        namespace: "my-idp",
        clientName: "default",
      },
    };
    expect(processIdpUser(auth)).toBeUndefined();
  });

  it("returns metadata when idProvider is BuiltInIdP and userProfile is defined", () => {
    const auth: GeneratorAuthInput = {
      name: "main-auth",
      idProvider: {
        name: "my-idp",
        kind: "BuiltInIdP",
        namespace: "my-idp",
        clientName: "default",
      },
      userProfile: {
        typeName: "User",
        namespace: "main-db",
        usernameField: "email",
      },
    };
    const result = processIdpUser(auth);
    expect(result).toEqual({
      name: "_User",
      dependencies: ["User"],
      dataFile: "data/_User.jsonl",
      idpNamespace: "my-idp",
      schema: {
        usernameField: "email",
        userTypeName: "User",
      },
    });
  });
});
