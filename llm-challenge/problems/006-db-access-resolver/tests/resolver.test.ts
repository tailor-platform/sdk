import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("006-db-access-resolver", () => {
  const resolverPath = path.join(workDir, "resolvers/getUser.ts");

  test("resolvers/getUser.ts exists", () => {
    expect(fs.existsSync(resolverPath)).toBe(true);
  });

  test("resolver has a default export", async () => {
    const mod = await import(resolverPath);
    expect(mod.default).toBeDefined();
  });

  test("resolver has correct name", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.name).toBe("getUser");
  });

  test("resolver has correct operation", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.operation).toBe("query");
  });

  test("resolver has input field id with string type", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.input).toBeDefined();
    expect(resolver.input.id).toBeDefined();
    expect(resolver.input.id.type).toBe("string");
  });

  test("resolver body is a function", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(typeof resolver.body).toBe("function");
  });

  test("resolver output has name and email fields", async () => {
    const mod = await import(resolverPath);
    const resolver = mod.default;
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.name).toBeDefined();
    expect(resolver.output.fields.name.type).toBe("string");
    expect(resolver.output.fields.email).toBeDefined();
    expect(resolver.output.fields.email.type).toBe("string");
  });
});
