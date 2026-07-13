// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expect, test } from "vitest";
import { getConfigSourceDir } from "#/utils/caller-dir";
import { defineConfig } from "./index";

describe("defineConfig", () => {
  test("rejects configuration with unknown properties", () => {
    defineConfig({
      name: "my-app",
      // @ts-expect-error - unknownProperty is not a valid AppConfig property
      unknownProperty: "value",
    });
  });

  test("accepts logLevel from an environment variable fallback", () => {
    defineConfig({
      name: "my-app",
      logLevel: process.env.LOG_LEVEL ?? "DEBUG",
    });
  });

  test("does not mutate the input object; the source dir is only on the returned object", () => {
    const input = { name: "my-app" };
    const result = defineConfig(input);

    expect(getConfigSourceDir(input)).toBeUndefined();
    expect(getConfigSourceDir(result)).toBeDefined();
  });
});
