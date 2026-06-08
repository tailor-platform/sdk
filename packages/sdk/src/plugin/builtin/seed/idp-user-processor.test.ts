import { describe, expect, test } from "vitest";
import { generateIdpUserSchemaFile, processIdpUser } from "./idp-user-processor";
import type { GeneratorAuthInput } from "@/types/plugin-generation";

describe("processIdpUser", () => {
  test("returns undefined when idProvider is not BuiltInIdP", () => {
    const auth: GeneratorAuthInput = {
      name: "main-auth",
      machineUsers: { admin: { attributes: { role: "admin" } } },
    };
    expect(processIdpUser(auth)).toBeUndefined();
  });

  test("returns undefined when idProvider is BuiltInIdP but userProfile is missing", () => {
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

  test("returns metadata when idProvider is BuiltInIdP and userProfile is defined", () => {
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

describe("generateIdpUserSchemaFile", () => {
  const options = { usernameField: "email", userTypeName: "User" };

  test("emits the userProfile foreign key by default", () => {
    const output = generateIdpUserSchemaFile(options);
    expect(output).toContain("foreignKeys: [");
    expect(output).toContain('table: "User"');
    expect(output).toContain('column: "email"');
  });

  test("emits the userProfile foreign key when includeUserProfileFK is true", () => {
    const output = generateIdpUserSchemaFile({ ...options, includeUserProfileFK: true });
    expect(output).toContain("foreignKeys: [");
  });

  test("omits the userProfile foreign key when includeUserProfileFK is false", () => {
    const output = generateIdpUserSchemaFile({ ...options, includeUserProfileFK: false });
    expect(output).not.toContain("foreignKeys");
    expect(output).toContain('primaryKey: "name"');
    expect(output).toContain("_user_name_unique_idx");
  });
});
