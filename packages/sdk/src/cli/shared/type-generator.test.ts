import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defineAuth } from "#/configure/services/auth/index";
import { t } from "#/configure/types/type";
import {
  extractAttributesFromConfig,
  generateTypeDefinition,
  resolveTypeDefinitionPath,
} from "./type-generator";
import type { AttributeListConfig, AttributesConfig } from "./type-generator";

describe("generateTypeDefinition", () => {
  test.each<{
    name: string;
    args: Parameters<typeof generateTypeDefinition>;
    expected: string[];
  }>([
    {
      name: "generates tuple type in __tuple property",
      args: [undefined, ["attr1", "attr2"]],
      expected: ["__tuple?: [string, string]"],
    },
    {
      name: "generates Attributes interface",
      args: [{ role: '"MANAGER" | "STAFF"', isActive: "boolean" }, undefined],
      expected: ["interface Attributes", 'role: "MANAGER" | "STAFF"', "isActive: boolean"],
    },
    {
      name: "generates empty Attributes when no attributes",
      args: [undefined, undefined],
      expected: ["interface Attributes {}", "interface AttributeList", "__tuple?: []"],
    },
    {
      name: "includes proper file header and structure",
      args: [undefined, undefined],
      expected: [
        "// This file is auto-generated",
        'declare module "@tailor-platform/sdk"',
        "export {};",
      ],
    },
    {
      name: "generates Env interface with literal types",
      args: [undefined, undefined, { hoge: 1, fuga: "hello", piyo: true }],
      expected: ["interface Env", "hoge: 1;", 'fuga: "hello";', "piyo: true;"],
    },
    {
      name: "generates empty Env interface when no env provided",
      args: [undefined, undefined],
      expected: ["interface Env {}"],
    },
    {
      name: "generates empty MachineUserNameRegistry when no machine users provided",
      args: [undefined, undefined],
      expected: ["interface MachineUserNameRegistry {}"],
    },
    {
      name: "generates empty IdpNameRegistry when no idps provided",
      args: [undefined, undefined],
      expected: ["interface IdpNameRegistry {}"],
    },
    {
      name: "generates IdpNameRegistry with idp names",
      args: [undefined, undefined, undefined, undefined, ["primary-idp", "backoffice"]],
      expected: ["interface IdpNameRegistry", '"primary-idp": true;', "backoffice: true;"],
    },
  ])("should $name", ({ args, expected }) => {
    const result = generateTypeDefinition(...args);
    for (const substring of expected) {
      expect(result).toContain(substring);
    }
  });

  test("should generate interface AttributeList for declaration merging", () => {
    const attributes: AttributesConfig = {
      role: '"MANAGER" | "STAFF"',
    };
    const attributeList: AttributeListConfig = [];

    const result = generateTypeDefinition(attributes, attributeList);

    expect(result).toContain("interface AttributeList");
    expect(result).not.toContain("type AttributeList =");
    expect(result).toContain("__tuple?: []");
  });

  test("should generate Attributes interface", () => {
    const attributes: AttributesConfig = {
      role: '"MANAGER" | "STAFF"',
      isActive: "boolean",
    };

    const result = generateTypeDefinition(attributes, undefined);

    expect(result).toContain("interface Attributes");
    expect(result).toContain('role: "MANAGER" | "STAFF"');
    expect(result).toContain("isActive: boolean");
  });

  test("should generate empty Attributes when no attributes", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface Attributes {}");
    expect(result).toContain("interface AttributeList");
    expect(result).toContain("__tuple?: []");
  });

  test("should include proper file header and structure", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("// This file is auto-generated");
    expect(result).toContain('declare module "@tailor-platform/sdk"');
    expect(result).toContain("export {};");
  });

  test("should generate Env interface with literal types", () => {
    const env = {
      hoge: 1,
      fuga: "hello",
      piyo: true,
    };

    const result = generateTypeDefinition(undefined, undefined, env);

    expect(result).toContain("interface Env");
    expect(result).toContain("hoge: 1;");
    expect(result).toContain('fuga: "hello";');
    expect(result).toContain("piyo: true;");
  });

  test("should generate empty Env interface when no env provided", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface Env {}");
  });

  test("should generate empty MachineUserNameRegistry when no machine users provided", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface MachineUserNameRegistry {}");
    expect(result).not.toContain('declare module "@tailor-platform/sdk/cli"');
  });

  test("should generate MachineUserNameRegistry with machine user names", () => {
    const result = generateTypeDefinition(undefined, undefined, undefined, [
      "manager-machine-user",
      "kiosk",
    ]);

    expect(result).toContain("interface MachineUserNameRegistry");
    expect(result).not.toContain('declare module "@tailor-platform/sdk/cli"');
    // Names with hyphens are quoted
    expect(result).toContain('"manager-machine-user": true;');
    // Valid identifiers are emitted unquoted (matches formatter output)
    expect(result).toContain("kiosk: true;");
    expect(result).not.toContain('"kiosk": true;');
  });

  test("should generate empty ConnectionNameRegistry when no connections provided", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface ConnectionNameRegistry {}");
  });

  test("should generate ConnectionNameRegistry with connection names", () => {
    const result = generateTypeDefinition(undefined, undefined, undefined, undefined, undefined, [
      "google-oauth",
      "ms365-oauth",
    ]);

    expect(result).toContain("interface ConnectionNameRegistry");
    expect(result).toContain('"google-oauth": true;');
    expect(result).toContain('"ms365-oauth": true;');
  });

  test("should generate empty AIGatewayNameRegistry when no AI Gateways provided", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface AIGatewayNameRegistry {}");
  });

  test("should generate AIGatewayNameRegistry with AI Gateway names", () => {
    const result = generateTypeDefinition(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ["my-aigateway", "second-gateway"],
    );

    expect(result).toContain("interface AIGatewayNameRegistry");
    expect(result).toContain('"my-aigateway": true;');
    expect(result).toContain('"second-gateway": true;');
  });
});

describe("resolveTypeDefinitionPath", () => {
  const originalEnv = process.env.TAILOR_DTS_PATH;

  beforeEach(() => {
    delete process.env.TAILOR_DTS_PATH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TAILOR_DTS_PATH = originalEnv;
    } else {
      delete process.env.TAILOR_DTS_PATH;
    }
  });

  test("should default to tailor.d.ts next to config file", () => {
    const result = resolveTypeDefinitionPath("/project/tailor.config.ts");
    expect(result).toBe(path.resolve("/project", "tailor.d.ts"));
  });

  test("should use TAILOR_DTS_PATH when set to an absolute path", () => {
    process.env.TAILOR_DTS_PATH = "/custom/output/types.d.ts";
    const result = resolveTypeDefinitionPath("/project/tailor.config.ts");
    expect(result).toBe("/custom/output/types.d.ts");
  });

  test("should resolve TAILOR_DTS_PATH relative to cwd when relative", () => {
    process.env.TAILOR_DTS_PATH = "custom/types.d.ts";
    const result = resolveTypeDefinitionPath("/project/tailor.config.ts");
    expect(result).toBe(path.resolve("custom/types.d.ts"));
  });
});

describe("extractAttributesFromConfig + generateTypeDefinition", () => {
  test("renders machineUserAttributes into Attributes", () => {
    const config = {
      name: "test-app",
      auth: defineAuth("auth", {
        machineUserAttributes: {
          role: t.enum(["ADMIN", "WORKER"]),
          isActive: t.bool(),
          tags: t.string({ array: true }),
        },
        machineUsers: {
          admin: {
            attributes: {
              role: "ADMIN",
              isActive: true,
              tags: ["root"],
            },
          },
        },
      }),
    };

    const { attributes } = extractAttributesFromConfig(config);
    const content = generateTypeDefinition(attributes, undefined);

    expect(content).toContain('role: "ADMIN" | "WORKER";');
    expect(content).toContain("isActive: boolean;");
    expect(content).toContain("tags: string[];");
  });

  test("extracts machine user names into MachineUserNameRegistry", () => {
    const config = {
      name: "test-app",
      auth: defineAuth("auth", {
        machineUserAttributes: {
          role: t.enum(["ADMIN", "WORKER"]),
        },
        machineUsers: {
          admin: { attributes: { role: "ADMIN" } },
          worker: { attributes: { role: "WORKER" } },
        },
      }),
    };

    const { attributes, machineUserNames } = extractAttributesFromConfig(config);
    expect(machineUserNames).toEqual(["admin", "worker"]);

    const content = generateTypeDefinition(attributes, undefined, undefined, machineUserNames);
    expect(content).toContain("interface MachineUserNameRegistry");
    expect(content).toContain("admin: true;");
    expect(content).toContain("worker: true;");
  });

  test("extracts idp names into IdpNameRegistry", () => {
    const config = {
      name: "test-app",
      idp: [{ name: "primary-idp" } as never, { name: "backoffice" } as never],
    };

    const { idpNames } = extractAttributesFromConfig(config);
    expect(idpNames).toEqual(["primary-idp", "backoffice"]);

    const content = generateTypeDefinition(undefined, undefined, undefined, undefined, idpNames);
    expect(content).toContain("interface IdpNameRegistry");
    expect(content).toContain('"primary-idp": true;');
    expect(content).toContain("backoffice: true;");
  });

  test("de-duplicates idp names so the registry has unique keys", () => {
    const config = {
      name: "test-app",
      idp: [
        { name: "primary-idp" } as never,
        { name: "backoffice" } as never,
        { name: "primary-idp" } as never,
      ],
    };

    const { idpNames } = extractAttributesFromConfig(config);
    expect(idpNames).toEqual(["primary-idp", "backoffice"]);
  });

  test("extracts connection names into ConnectionNameRegistry", () => {
    const config = {
      name: "test-app",
      auth: defineAuth("auth", {
        machineUserAttributes: {},
        machineUsers: {},
        connections: {
          "google-oauth": {
            type: "oauth2",
            providerUrl: "https://accounts.google.com",
            issuerUrl: "https://accounts.google.com",
            clientId: "x",
            clientSecret: "y",
          },
          "ms365-oauth": {
            type: "oauth2",
            providerUrl: "https://login.microsoftonline.com",
            issuerUrl: "https://login.microsoftonline.com",
            clientId: "x",
            clientSecret: "y",
          },
        },
      }),
    };

    const { connectionNames } = extractAttributesFromConfig(config);
    expect(connectionNames).toEqual(["google-oauth", "ms365-oauth"]);

    const content = generateTypeDefinition(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      connectionNames,
    );
    expect(content).toContain("interface ConnectionNameRegistry");
    expect(content).toContain('"google-oauth": true;');
    expect(content).toContain('"ms365-oauth": true;');
  });

  test("extracts AI Gateway names into AIGatewayNameRegistry", () => {
    const config = {
      name: "test-app",
      aiGateways: [{ name: "my-aigateway" } as never, { name: "second-gateway" } as never],
    };

    const { aiGatewayNames } = extractAttributesFromConfig(config);
    expect(aiGatewayNames).toEqual(["my-aigateway", "second-gateway"]);

    const content = generateTypeDefinition(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      aiGatewayNames,
    );
    expect(content).toContain("interface AIGatewayNameRegistry");
    expect(content).toContain('"my-aigateway": true;');
    expect(content).toContain('"second-gateway": true;');
  });

  test("de-duplicates AI Gateway names so the registry has unique keys", () => {
    const config = {
      name: "test-app",
      aiGateways: [
        { name: "my-aigateway" } as never,
        { name: "second-gateway" } as never,
        { name: "my-aigateway" } as never,
      ],
    };

    const { aiGatewayNames } = extractAttributesFromConfig(config);
    expect(aiGatewayNames).toEqual(["my-aigateway", "second-gateway"]);
  });
});
