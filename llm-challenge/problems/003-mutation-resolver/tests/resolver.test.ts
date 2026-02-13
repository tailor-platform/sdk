import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";

const workDir = path.resolve(import.meta.dirname, "..", "work");
const workDirExists = fs.existsSync(workDir);

describe.skipIf(!workDirExists)("003-mutation-resolver", () => {
  test("resolvers/formatName.ts exists", () => {
    expect(fs.existsSync(path.join(workDir, "resolvers/formatName.ts"))).toBe(true);
  });

  test("resolver has a default export", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    expect(mod.default).toBeDefined();
  });

  test("resolver has correct name", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    expect(resolver.name).toBe("formatName");
  });

  test("resolver has correct operation", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    expect(resolver.operation).toBe("mutation");
  });

  test("resolver has correct input fields", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    expect(resolver.input).toBeDefined();
    expect(resolver.input.firstName).toBeDefined();
    expect(resolver.input.firstName.type).toBe("string");
    expect(resolver.input.lastName).toBeDefined();
    expect(resolver.input.lastName.type).toBe("string");
    expect(resolver.input.uppercase).toBeDefined();
    expect(resolver.input.uppercase.type).toBe("boolean");
    expect(resolver.input.uppercase.metadata.required).toBe(false);
  });

  test("resolver body formats name without uppercase", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { firstName: "John", lastName: "Doe" },
      user: {},
      env: {},
    });
    expect(result).toEqual({ fullName: "John Doe", initials: "JD" });
  });

  test("resolver body formats name with uppercase true", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { firstName: "Jane", lastName: "Smith", uppercase: true },
      user: {},
      env: {},
    });
    expect(result).toEqual({ fullName: "JANE SMITH", initials: "JS" });
  });

  test("resolver body formats name with uppercase false", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { firstName: "John", lastName: "Doe", uppercase: false },
      user: {},
      env: {},
    });
    expect(result).toEqual({ fullName: "John Doe", initials: "JD" });
  });

  test("initials are always uppercase regardless of input case", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    const result = resolver.body({
      input: { firstName: "john", lastName: "doe" },
      user: {},
      env: {},
    });
    expect(result.initials).toBe("JD");
  });

  test("resolver output has fullName and initials fields", async () => {
    const mod = await import(path.join(workDir, "resolvers/formatName.ts"));
    const resolver = mod.default;
    expect(resolver.output).toBeDefined();
    expect(resolver.output.type).toBe("nested");
    expect(resolver.output.fields).toBeDefined();
    expect(resolver.output.fields.fullName).toBeDefined();
    expect(resolver.output.fields.fullName.type).toBe("string");
    expect(resolver.output.fields.initials).toBeDefined();
    expect(resolver.output.fields.initials.type).toBe("string");
  });
});
