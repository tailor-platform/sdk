import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("033-resolver-user-context", () => {
  const resolverPath = path.join(workDir, "resolvers/whoami/resolver.ts");

  test("resolvers/whoami/resolver.ts exists", () => {
    expect(fs.existsSync(resolverPath)).toBe(true);
  });

  test("has default export", async () => {
    const mod = await import(resolverPath);
    expect(mod.default).toBeDefined();
  });

  test("resolver name is 'whoami'", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.name).toBe("whoami");
  });

  test("resolver operation is 'query'", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.operation).toBe("query");
  });

  test("resolver has no input", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(
      resolver.input === undefined ||
        resolver.input === null ||
        Object.keys(resolver.input).length === 0,
    ).toBe(true);
  });

  test("body function exists and is callable", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(typeof resolver.body).toBe("function");
  });

  test("body returns correct user info from context", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;

    const result = resolver.body({
      input: {},
      user: {
        id: "user-123",
        type: "user",
        workspaceId: "ws-1",
        attributes: { role: "admin" },
        attributeList: [],
      },
      env: {},
    });
    expect(result).toEqual({
      userId: "user-123",
      userType: "user",
      attributes: { role: "admin" },
    });
  });

  test("body handles different user context values", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;

    const result = resolver.body({
      input: {},
      user: {
        id: "machine-456",
        type: "machine_user",
        workspaceId: "ws-2",
        attributes: { role: "service" },
        attributeList: [],
      },
      env: {},
    });
    expect(result).toEqual({
      userId: "machine-456",
      userType: "machine_user",
      attributes: { role: "service" },
    });
  });

  test("body handles empty attributes", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;

    const result = resolver.body({
      input: {},
      user: {
        id: "user-789",
        type: "user",
        workspaceId: "ws-3",
        attributes: {},
        attributeList: [],
      },
      env: {},
    });
    expect(result).toEqual({
      userId: "user-789",
      userType: "user",
      attributes: {},
    });
  });

  test("output has userId, userType, and attributes fields", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.userId).toBeDefined();
    expect(resolver.output.fields.userId.type).toBe("string");
    expect(resolver.output.fields.userType).toBeDefined();
    expect(resolver.output.fields.userType.type).toBe("string");
    expect(resolver.output.fields.attributes).toBeDefined();
    expect(resolver.output.fields.attributes.type).toBe("nested");
  });
});
