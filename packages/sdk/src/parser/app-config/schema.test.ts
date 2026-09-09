import { describe, expect, test } from "vitest";
import { AppConfigSchema } from "./schema";

describe("AppConfigSchema", () => {
  test("accepts a minimal valid config", () => {
    const result = AppConfigSchema.safeParse({ name: "my-app" });
    expect(result.success).toBe(true);
  });

  test("accepts a config with auto-generated UUID id", () => {
    const result = AppConfigSchema.safeParse({
      id: "c98794dd-9bf1-480f-a5c9-bf92b3679d42",
      name: "my-app",
    });
    expect(result.success).toBe(true);
  });

  test("rejects an id that is not a UUID", () => {
    const result = AppConfigSchema.safeParse({
      id: "not-a-uuid",
      name: "my-app",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected AppConfigSchema parsing to fail");
    }
    expect(result.error.issues[0]?.path).toEqual(["id"]);
  });

  test("rejects when name is missing", () => {
    const result = AppConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("rejects when name is an empty string", () => {
    const result = AppConfigSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  test("passes through builder-bearing fields without validating their shape", () => {
    const result = AppConfigSchema.safeParse({
      name: "my-app",
      auth: { __builder: Symbol("auth") },
      idp: [{ __builder: Symbol("idp") }],
      staticWebsites: [{ __builder: Symbol("ws") }],
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown top-level fields", () => {
    const result = AppConfigSchema.safeParse({
      name: "my-app",
      futureField: "ok",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected AppConfigSchema parsing to fail");
    }
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unrecognized_keys",
          keys: ["futureField"],
        }),
      ]),
    );
  });

  test("rejects when env value type is unsupported", () => {
    const result = AppConfigSchema.safeParse({
      name: "my-app",
      env: { foo: { nested: true } },
    });
    expect(result.success).toBe(false);
  });

  test("accepts supported log levels case-insensitively", () => {
    const result = AppConfigSchema.safeParse({
      name: "my-app",
      logLevel: "warn",
    });
    expect(result.success).toBe(true);
  });

  test("rejects unsupported log levels", () => {
    const result = AppConfigSchema.safeParse({
      name: "my-app",
      logLevel: "OFF",
    });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected AppConfigSchema parsing to fail");
    }
    expect(result.error.issues[0]?.path).toEqual(["logLevel"]);
  });

  describe("metadata", () => {
    function parseMetadata(metadata: unknown) {
      return AppConfigSchema.safeParse({ name: "my-app", metadata });
    }

    test("accepts label-shaped keys and values", () => {
      const result = parseMetadata({
        "erp-kit-version": "v1-2-3",
        team: "",
        a_b: "x",
        [`a${"b".repeat(62)}`]: `v${"1".repeat(62)}`,
      });
      expect(result.success).toBe(true);
    });

    test("accepts an empty record", () => {
      expect(parseMetadata({}).success).toBe(true);
    });

    test.each([
      ["camelCase", "erpKit"],
      ["a leading digit", "1abc"],
      ["a leading hyphen", "-abc"],
      ["a dot", "erp.kit"],
      ["an empty key", ""],
      ["64 characters", `a${"b".repeat(63)}`],
    ])("rejects a key with %s", (_case, key) => {
      const result = parseMetadata({ [key]: "ok" });
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("Expected AppConfigSchema parsing to fail");
      }
      expect(result.error.issues[0]?.path).toEqual(["metadata", key]);
      expect(result.error.issues[0]?.message).toContain("^[a-z][a-z0-9_-]{0,62}$");
    });

    test("rejects keys reserved for the SDK", () => {
      const result = parseMetadata({ "sdk-version": "v9-9-9" });
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("Expected AppConfigSchema parsing to fail");
      }
      expect(result.error.issues[0]?.path).toEqual(["metadata", "sdk-version"]);
      expect(result.error.issues[0]?.message).toContain("sdk-");
    });

    test.each([
      ["a dotted version", "1.2.3"],
      ["a leading digit", "1-2-3"],
      ["uppercase", "V1"],
      ["64 characters", `v${"1".repeat(63)}`],
    ])("rejects a value with %s", (_case, value) => {
      const result = parseMetadata({ "erp-kit-version": value });
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("Expected AppConfigSchema parsing to fail");
      }
      expect(result.error.issues[0]?.path).toEqual(["metadata", "erp-kit-version"]);
      expect(result.error.issues[0]?.message).toContain("^$|^[a-z][a-z0-9_-]{0,62}$");
    });

    test("rejects non-string values", () => {
      expect(parseMetadata({ count: 1 }).success).toBe(false);
    });

    test("caps the entry count so the SDK's own labels still fit the platform limit", () => {
      const entries = (count: number) =>
        Object.fromEntries(Array.from({ length: count }, (_, i) => [`key-${i}`, "v"]));

      expect(parseMetadata(entries(17)).success).toBe(true);

      const result = parseMetadata(entries(18));
      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error("Expected AppConfigSchema parsing to fail");
      }
      expect(result.error.issues[0]?.path).toEqual(["metadata"]);
      expect(result.error.issues[0]?.message).toContain("17");
    });
  });
});
