// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
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
});
