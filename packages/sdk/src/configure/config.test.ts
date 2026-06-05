import { describe, test } from "vitest";
import { defineConfig } from "./config";

describe("defineConfig", () => {
  test("rejects configuration with unknown properties", () => {
    defineConfig({
      name: "my-app",
      // @ts-expect-error - unknownProperty is not a valid AppConfig property
      unknownProperty: "value",
    });
  });
});
