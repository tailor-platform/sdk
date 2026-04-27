import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineAuth } from "@/configure/services/auth";
import { t } from "@/configure/types/type";
import {
  extractAttributesFromConfig,
  generateTypeDefinition,
  resolveTypeDefinitionPath,
} from "./type-generator";
import type { AttributeListConfig, AttributeMapConfig } from "./type-generator";

describe("generateTypeDefinition", () => {
  it("should generate tuple type in __tuple property", () => {
    const attributeList: AttributeListConfig = ["attr1", "attr2"];

    const result = generateTypeDefinition(undefined, attributeList);

    expect(result).toContain("__tuple?: [string, string]");
  });

  it("should generate interface AttributeList for declaration merging", () => {
    const attributeMap: AttributeMapConfig = {
      role: '"MANAGER" | "STAFF"',
    };
    const attributeList: AttributeListConfig = [];

    const result = generateTypeDefinition(attributeMap, attributeList);

    // Should use interface instead of type for AttributeList
    expect(result).toContain("interface AttributeList");
    expect(result).not.toContain("type AttributeList =");
    expect(result).toContain("__tuple?: []");
  });

  it("should generate AttributeMap interface", () => {
    const attributeMap: AttributeMapConfig = {
      role: '"MANAGER" | "STAFF"',
      isActive: "boolean",
    };

    const result = generateTypeDefinition(attributeMap, undefined);

    expect(result).toContain("interface AttributeMap");
    expect(result).toContain('role: "MANAGER" | "STAFF"');
    expect(result).toContain("isActive: boolean");
  });

  it("should generate empty AttributeMap when no attributes", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface AttributeMap {}");
    expect(result).toContain("interface AttributeList");
    expect(result).toContain("__tuple?: []");
  });

  it("should include proper file header and structure", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("// This file is auto-generated");
    expect(result).toContain('declare module "@tailor-platform/sdk"');
    expect(result).toContain("export {};");
  });

  it("should generate Env interface with literal types", () => {
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

  it("should generate empty Env interface when no env provided", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface Env {}");
  });

  it("should generate empty MachineUserNameRegistry when no machine users provided", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface MachineUserNameRegistry {}");
  });

  it("should generate MachineUserNameRegistry with machine user names", () => {
    const result = generateTypeDefinition(undefined, undefined, undefined, [
      "manager-machine-user",
      "kiosk",
    ]);

    expect(result).toContain("interface MachineUserNameRegistry");
    // Names with hyphens are quoted
    expect(result).toContain('"manager-machine-user": true;');
    // Valid identifiers are emitted unquoted (matches formatter output)
    expect(result).toContain("kiosk: true;");
    expect(result).not.toContain('"kiosk": true;');
  });

  it("should generate empty IdpNameRegistry when no idps provided", () => {
    const result = generateTypeDefinition(undefined, undefined);

    expect(result).toContain("interface IdpNameRegistry {}");
  });

  it("should generate IdpNameRegistry with idp names", () => {
    const result = generateTypeDefinition(undefined, undefined, undefined, undefined, [
      "primary-idp",
      "backoffice",
    ]);

    expect(result).toContain("interface IdpNameRegistry");
    expect(result).toContain('"primary-idp": true;');
    expect(result).toContain("backoffice: true;");
  });
});

describe("resolveTypeDefinitionPath", () => {
  const originalEnv = process.env.TAILOR_PLATFORM_SDK_DTS_PATH;

  beforeEach(() => {
    delete process.env.TAILOR_PLATFORM_SDK_DTS_PATH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TAILOR_PLATFORM_SDK_DTS_PATH = originalEnv;
    } else {
      delete process.env.TAILOR_PLATFORM_SDK_DTS_PATH;
    }
  });

  it("should default to tailor.d.ts next to config file", () => {
    const result = resolveTypeDefinitionPath("/project/tailor.config.ts");
    expect(result).toBe(path.resolve("/project", "tailor.d.ts"));
  });

  it("should use TAILOR_PLATFORM_SDK_DTS_PATH when set to an absolute path", () => {
    process.env.TAILOR_PLATFORM_SDK_DTS_PATH = "/custom/output/types.d.ts";
    const result = resolveTypeDefinitionPath("/project/tailor.config.ts");
    expect(result).toBe("/custom/output/types.d.ts");
  });

  it("should resolve TAILOR_PLATFORM_SDK_DTS_PATH relative to cwd when relative", () => {
    process.env.TAILOR_PLATFORM_SDK_DTS_PATH = "custom/types.d.ts";
    const result = resolveTypeDefinitionPath("/project/tailor.config.ts");
    expect(result).toBe(path.resolve("custom/types.d.ts"));
  });
});

describe("extractAttributesFromConfig + generateTypeDefinition", () => {
  it("renders machineUserAttributes into AttributeMap", () => {
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

    const { attributeMap } = extractAttributesFromConfig(config);
    const content = generateTypeDefinition(attributeMap, undefined);

    expect(content).toContain('role: "ADMIN" | "WORKER";');
    expect(content).toContain("isActive: boolean;");
    expect(content).toContain("tags: string[];");
  });

  it("extracts machine user names into MachineUserNameRegistry", () => {
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

    const { attributeMap, machineUserNames } = extractAttributesFromConfig(config);
    expect(machineUserNames).toEqual(["admin", "worker"]);

    const content = generateTypeDefinition(attributeMap, undefined, undefined, machineUserNames);
    expect(content).toContain("interface MachineUserNameRegistry");
    expect(content).toContain("admin: true;");
    expect(content).toContain("worker: true;");
  });

  it("extracts idp names into IdpNameRegistry", () => {
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
});
