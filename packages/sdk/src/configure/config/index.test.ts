// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
import { defineIdp } from "#/configure/services/idp/index";
import { defineConfig } from "./index";

describe("defineConfig", () => {
  test("rejects configuration with unknown properties", () => {
    defineConfig({
      name: "my-app",
      // @ts-expect-error - unknownProperty is not a valid AppConfig property
      unknownProperty: "value",
    });
  });

  test("accepts metadata as a record of string labels", () => {
    defineConfig({
      name: "my-app",
      metadata: { "erp-kit-version": "v1-2-3" },
    });
    defineConfig({
      name: "my-app",
      // @ts-expect-error - metadata values must be strings
      metadata: { count: 1 },
    });
  });

  test("accepts idp as a single IdP or as an array", () => {
    const idp = defineIdp("my-idp", { clients: ["my-client"] });
    defineConfig({ name: "my-app", idp });
    defineConfig({ name: "my-app", idp: [idp] });
    defineConfig({ name: "my-app", idp: { name: "shared-idp", external: true } });
    defineConfig({
      name: "my-app",
      // @ts-expect-error - idp must be an IdP or an array of IdPs, not a name
      idp: "my-idp",
    });
  });

  test("accepts logLevel from an environment variable fallback", () => {
    defineConfig({
      name: "my-app",
      logLevel: process.env.TAILOR_APP_LOG_LEVEL ?? "DEBUG",
    });
  });
});
