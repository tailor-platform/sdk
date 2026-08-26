import * as path from "pathe";
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
    tables: Object.fromEntries(types.map((type) => [type.name, type])),
    sourceInfo: new Map(
      types.map((type) => [
        type.name,
        { filePath: `${namespace}/${type.name}.ts`, exportName: type.name },
      ]),
    ),
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
    application: { tailorDBServices: [], ...result.application },
    namespaces: result.namespaces ?? [],
  } as LoadedApplicationNamespaces);
}

function fakeService(namespace: string, tableNames: string[]) {
  return {
    namespace,
    types: Object.fromEntries(tableNames.map((name) => [name, fakeType(name, {})])),
    typeSourceInfo: Object.fromEntries(
      tableNames.map((name) => [name, { filePath: `${namespace}/${name}.ts`, exportName: name }]),
    ),
  };
}

function seedPluginInstance(pluginConfig: object): Plugin {
  return { id: "@tailor-platform/seed", pluginConfig } as Plugin;
}

function fakeAuthService(config: object, userProfileAfterResolve?: object) {
  let userProfile: object | undefined;
  return {
    config,
    get userProfile() {
      return userProfile;
    },
    resolveNamespaces: async () => {
      userProfile = userProfileAfterResolve;
    },
  } as unknown as Application["authService"];
}

describe("loadSeedContext", () => {
  test("throws an actionable error when seedPlugin is not configured", async () => {
    mockLoadResult({ plugins: [{ id: "@tailor-platform/other" } as Plugin] });

    await expect(loadSeedContext()).rejects.toThrow(
      /seedPlugin is not configured in \/proj\/tailor\.config\.ts/,
    );
  });

  test("rejects duplicate type names across namespaces", async () => {
    mockLoadResult({
      plugins: [seedPluginInstance({ distPath: "./seed" })],
      application: {
        tailorDBServices: [fakeService("main-db", ["User"]), fakeService("sub-db", ["User"])],
      } as unknown as Partial<Application>,
    });

    await expect(loadSeedContext()).rejects.toThrow(/User/);
  });

  test("throws when seedPlugin has no distPath", async () => {
    mockLoadResult({ plugins: [seedPluginInstance({})] });

    await expect(loadSeedContext()).rejects.toThrow(/has no distPath option/);
  });

  test("resolves a relative distPath against the working directory", async () => {
    mockLoadResult({ plugins: [seedPluginInstance({ distPath: "./seed" })] });

    const context = await loadSeedContext();
    expect(context.distPath).toBe(path.resolve("./seed"));
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
        requiredFields: { User: [], Order: ["user", "parent"] },
      },
    ]);
  });

  test("includes IdP user context for BuiltInIdP with a user profile", async () => {
    mockLoadResult({
      plugins: [seedPluginInstance({ distPath: "./seed" })],
      application: {
        // userProfile only becomes available after resolveNamespaces() runs,
        // mirroring the real auth service lifecycle.
        authService: fakeAuthService(
          {
            name: "main-auth",
            machineUsers: {},
            idProvider: { kind: "BuiltInIdP", namespace: "main-idp" },
          },
          {
            type: { name: "Staff" },
            namespace: "main-db",
            usernameField: "email",
          },
        ),
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
        authService: fakeAuthService({
          name: "main-auth",
          machineUsers: {},
          idProvider: { kind: "OIDC", namespace: "ext-idp" },
        }),
      },
    });

    const context = await loadSeedContext();
    expect(context.idpUser).toBeNull();
  });
});
