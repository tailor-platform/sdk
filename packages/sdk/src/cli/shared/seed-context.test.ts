import { describe, expect, test, vi } from "vitest";
import { loadSeedContext } from "./seed-context";
import type { Application } from "#/cli/services/application";
import type { TailorDBType } from "#/parser/service/tailordb/types";
import type { Plugin, TailorDBNamespaceData } from "#/plugin/types";
import type { LoadedApplicationNamespaces } from "./tailordb-namespaces";

const loadApplicationNamespaces = vi.hoisted(() =>
  vi.fn<() => Promise<LoadedApplicationNamespaces>>(),
);

vi.mock("./tailordb-namespaces", () => ({ loadApplicationNamespaces }));

function fakeType(name: string, fields: Record<string, object>): TailorDBType {
  return { name, fields } as unknown as TailorDBType;
}

function fakeNamespace(namespace: string, types: TailorDBType[]): TailorDBNamespaceData {
  return {
    namespace,
    types: Object.fromEntries(types.map((type) => [type.name, type])),
    sourceInfo: new Map(),
    pluginAttachments: new Map(),
  };
}

type FakeLoadResult = {
  plugins?: Plugin[];
  application?: Partial<Application>;
  namespaces?: TailorDBNamespaceData[];
};

function mockLoadResult(result: FakeLoadResult): void {
  loadApplicationNamespaces.mockResolvedValue({
    config: { path: "/proj/tailor.config.ts" },
    plugins: result.plugins ?? [],
    application: result.application ?? {},
    namespaces: result.namespaces ?? [],
  } as LoadedApplicationNamespaces);
}

function seedPluginInstance(pluginConfig: object): Plugin {
  return { id: "@tailor-platform/seed", pluginConfig } as Plugin;
}

describe("loadSeedContext", () => {
  test("throws an actionable error when seedPlugin is not configured", async () => {
    mockLoadResult({ plugins: [{ id: "@tailor-platform/other" } as Plugin] });

    await expect(loadSeedContext()).rejects.toThrow(
      /seedPlugin is not configured in \/proj\/tailor\.config\.ts/,
    );
  });

  test("resolves a relative distPath against the config directory", async () => {
    mockLoadResult({ plugins: [seedPluginInstance({ distPath: "./seed" })] });

    const context = await loadSeedContext();
    expect(context.distPath).toBe("/proj/seed");
    expect(context.machineUserName).toBeUndefined();
    expect(context.idpUser).toBeNull();
  });

  test("keeps an absolute distPath and the configured machine user", async () => {
    mockLoadResult({
      plugins: [seedPluginInstance({ distPath: "/out/seed", machineUserName: "admin" })],
    });

    const context = await loadSeedContext();
    expect(context.distPath).toBe("/out/seed");
    expect(context.machineUserName).toBe("admin");
  });

  test("builds per-namespace seed ordering from relations", async () => {
    const user = fakeType("User", { id: { config: {} } });
    const order = fakeType("Order", {
      user: { relation: { targetType: "User" }, config: {} },
      parent: { config: { foreignKeyType: "Order" } },
    });
    mockLoadResult({
      plugins: [seedPluginInstance({ distPath: "./seed" })],
      namespaces: [fakeNamespace("main-db", [user, order])],
    });

    const context = await loadSeedContext();
    expect(context.namespaces).toEqual([
      {
        namespace: "main-db",
        types: ["User", "Order"],
        dependencies: { User: [], Order: ["User"] },
        selfRefTypes: ["Order"],
      },
    ]);
  });

  test("includes IdP user context for BuiltInIdP with a user profile", async () => {
    mockLoadResult({
      plugins: [seedPluginInstance({ distPath: "./seed" })],
      application: {
        authService: {
          config: {
            name: "main-auth",
            machineUsers: {},
            idProvider: { kind: "BuiltInIdP", namespace: "main-idp" },
          },
          userProfile: {
            type: { name: "Staff" },
            namespace: "main-db",
            usernameField: "email",
          },
        } as unknown as Application["authService"],
      },
    });

    const context = await loadSeedContext();
    expect(context.idpUser).not.toBeNull();
    expect(context.idpUser?.idpNamespace).toBe("main-idp");
    expect(context.idpUser?.seedScriptCode).toContain('namespace: "main-idp"');
    expect(context.idpUser?.truncateScriptCode).toContain('namespace: "main-idp"');
  });

  test("omits IdP user context when the IdP is not built-in", async () => {
    mockLoadResult({
      plugins: [seedPluginInstance({ distPath: "./seed" })],
      application: {
        authService: {
          config: {
            name: "main-auth",
            machineUsers: {},
            idProvider: { kind: "OIDC", namespace: "ext-idp" },
          },
          userProfile: undefined,
        } as unknown as Application["authService"],
      },
    });

    const context = await loadSeedContext();
    expect(context.idpUser).toBeNull();
  });
});
