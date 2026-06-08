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

  test("ignores unknown top-level fields without erroring", () => {
    const result = AppConfigSchema.safeParse({
      name: "my-app",
      futureField: "ok",
    });
    expect(result.success).toBe(true);
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
});
