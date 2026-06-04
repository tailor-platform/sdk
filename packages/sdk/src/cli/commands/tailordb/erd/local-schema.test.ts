import { describe, expect, it } from "vitest";
import { resolveLocalErdSchemaNamespaces } from "./local-schema";
import type { LoadedConfig } from "@/cli/shared/config-loader";

describe("resolveLocalErdSchemaNamespaces", () => {
  const config = {
    path: "/tmp/tailor.config.ts",
    db: {
      main: { files: ["tailordb/main/*.ts"], erdSite: "main-erd" },
      admin: { files: ["tailordb/admin/*.ts"] },
      external: { external: true },
    },
  } as unknown as LoadedConfig;

  it("loads only erdSite namespaces when required and no namespace is explicit", () => {
    expect(resolveLocalErdSchemaNamespaces(config, { requireErdSite: true })).toEqual(["main"]);
  });

  it("keeps explicit namespaces even when erdSite is required", () => {
    expect(
      resolveLocalErdSchemaNamespaces(config, {
        namespaces: ["admin"],
        requireErdSite: true,
      }),
    ).toEqual(["admin"]);
  });

  it("loads all owned namespaces when erdSite is not required", () => {
    expect(resolveLocalErdSchemaNamespaces(config, {})).toBeUndefined();
  });
});
