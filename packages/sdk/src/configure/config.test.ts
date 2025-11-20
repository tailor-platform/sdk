import { describe, it } from "vitest";
import { defineConfig } from "./config";

describe("defineConfig", () => {
  it("rejects configuration with unknown properties", () => {
    defineConfig({
      name: "my-app",
      // @ts-expect-error - unknownProperty is not a valid AppConfig property
      unknownProperty: "value",
    });
  });
});
