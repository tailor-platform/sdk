import { describe, expect, test } from "vitest";
import { resolveErdSites, resolveLocalErdSchemaNamespaces } from "./local-schema";
import { tailordbErdPlugin } from "./index";
import type { LoadedConfig, Plugin } from "@tailor-platform/sdk/cli";

const config = {
  path: "/tmp/tailor.config.ts",
  db: {
    main: { files: ["tailordb/main/*.ts"] },
    admin: { files: ["tailordb/admin/*.ts"] },
    external: { external: true },
  },
  staticWebsites: [{ name: "main-erd" }, { name: "admin-erd" }],
} as unknown as LoadedConfig;

describe("resolveErdSites", () => {
  test("returns sites from the registered tailordbErdPlugin instance", () => {
    const plugins = [tailordbErdPlugin({ sites: { main: "main-erd" } })] as Plugin[];
    expect(resolveErdSites(config, plugins)).toEqual({
      sites: { main: "main-erd" },
      issues: [],
    });
  });

  test("returns an empty mapping when the plugin is not registered", () => {
    expect(resolveErdSites(config, [])).toEqual({ sites: {}, issues: [] });
    expect(resolveErdSites(config, undefined)).toEqual({ sites: {}, issues: [] });
  });

  test("ignores unrelated plugins", () => {
    const plugins = [
      { id: "other-plugin", description: "other", pluginConfig: { sites: { main: "x" } } },
      tailordbErdPlugin({ sites: { main: "main-erd" } }),
    ] as Plugin[];
    expect(resolveErdSites(config, plugins).sites).toEqual({ main: "main-erd" });
  });

  test("throws when the plugin is registered more than once", () => {
    const plugins = [
      tailordbErdPlugin({ sites: { main: "main-erd" } }),
      tailordbErdPlugin({ sites: { admin: "admin-erd" } }),
    ] as Plugin[];
    expect(() => resolveErdSites(config, plugins)).toThrow(/registered more than once/);
  });

  test("throws on an invalid plugin configuration", () => {
    const plugins = [
      { id: "@tailor-platform/sdk-plugin-tailordb-erd", description: "erd", pluginConfig: {} },
    ] as Plugin[];
    expect(() => resolveErdSites(config, plugins)).toThrow(/Invalid tailordbErdPlugin/);
  });

  test("reports an issue when a namespace is not in config.db", () => {
    const plugins = [tailordbErdPlugin({ sites: { missing: "main-erd" } })] as Plugin[];
    const { issues } = resolveErdSites(config, plugins);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(
      /namespace "missing" not found in config\.db.*Available owned namespaces: main, admin/,
    );
  });

  test("reports an issue when a namespace is external", () => {
    const plugins = [tailordbErdPlugin({ sites: { external: "main-erd" } })] as Plugin[];
    expect(resolveErdSites(config, plugins).issues[0]).toMatch(/namespace "external" not found/);
  });

  test("reports an issue when a site is not a defined static website", () => {
    const plugins = [tailordbErdPlugin({ sites: { main: "typo-erd" } })] as Plugin[];
    expect(resolveErdSites(config, plugins).issues[0]).toMatch(
      /static website "typo-erd" \(namespace "main"\) not found in staticWebsites.*Available static websites: main-erd, admin-erd/,
    );
  });

  test("reports an issue when no static websites are defined at all", () => {
    const bareConfig = { ...config, staticWebsites: undefined } as unknown as LoadedConfig;
    const plugins = [tailordbErdPlugin({ sites: { main: "main-erd" } })] as Plugin[];
    expect(resolveErdSites(bareConfig, plugins).issues[0]).toMatch(/static website "main-erd"/);
  });

  test("collects issues across entries while keeping valid ones in sites", () => {
    const plugins = [
      tailordbErdPlugin({ sites: { main: "main-erd", missing: "x", admin: "typo" } }),
    ] as Plugin[];
    const { sites, issues } = resolveErdSites(config, plugins);
    expect(sites).toEqual({ main: "main-erd", missing: "x", admin: "typo" });
    expect(issues).toHaveLength(2);
  });
});

describe("resolveLocalErdSchemaNamespaces", () => {
  const sites = { main: "main-erd" };

  test("loads only namespaces with an ERD site when required and no namespace is explicit", () => {
    expect(resolveLocalErdSchemaNamespaces(sites, { requireErdSite: true })).toEqual(["main"]);
  });

  test("keeps explicit namespaces even when an ERD site is required", () => {
    expect(
      resolveLocalErdSchemaNamespaces(sites, {
        namespaces: ["admin"],
        requireErdSite: true,
      }),
    ).toEqual(["admin"]);
  });

  test("loads all owned namespaces when an ERD site is not required", () => {
    expect(resolveLocalErdSchemaNamespaces(sites, {})).toBeUndefined();
  });
});
