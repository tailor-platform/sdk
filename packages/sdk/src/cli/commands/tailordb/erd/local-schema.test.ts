import { describe, expect, test } from "vitest";
import { resolveLocalErdSchemaNamespaces } from "./local-schema";
import type { LoadedConfig } from "#src/cli/shared/config-loader";

describe("resolveLocalErdSchemaNamespaces", () => {
  const config = {
    path: "/tmp/tailor.config.ts",
    db: {
      main: { files: ["tailordb/main/*.ts"], erdSite: "main-erd" },
      admin: { files: ["tailordb/admin/*.ts"] },
      external: { external: true },
    },
  } as unknown as LoadedConfig;

  test("loads only erdSite namespaces when required and no namespace is explicit", () => {
    expect(resolveLocalErdSchemaNamespaces(config, { requireErdSite: true })).toEqual(["main"]);
  });

  test("keeps explicit namespaces even when erdSite is required", () => {
    expect(
      resolveLocalErdSchemaNamespaces(config, {
        namespaces: ["admin"],
        requireErdSite: true,
      }),
    ).toEqual(["admin"]);
  });

  test("loads all owned namespaces when erdSite is not required", () => {
    expect(resolveLocalErdSchemaNamespaces(config, {})).toBeUndefined();
  });
});
