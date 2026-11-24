import { describe, expect, test } from "vitest";
import { loadedWorkspace } from "#/cli/shared/test-helpers/workspace-config";
import { defineConfig } from "#/configure/config/index";
import { defineWorkspace } from "#/configure/config/workspace";
import { defineAuth } from "#/configure/services/auth/index";
import { configApplications, requireApplication, selectApplication } from "./config-applications";
import { getErrorDiagnostics } from "./error-diagnostics";
import type { WorkspaceApplicationConfig } from "#/configure/config/types";
import type { LoadedConfigFile } from "./config-loader";

const configPath = "/project/tailor.config.ts";

const shopAuth = defineAuth("shop-auth", {
  machineUserAttributes: {},
  machineUsers: {},
  oauth2Clients: {
    web: { redirectURIs: ["https://web.example.com"], grantTypes: ["authorization_code"] },
  },
});

type ShopApplications = Record<
  string,
  WorkspaceApplicationConfig<"customer-db", never, "shop-auth", never>
>;

function workspaceFile(apps: ShopApplications): LoadedConfigFile {
  return {
    kind: "workspace",
    workspace: loadedWorkspace(
      defineWorkspace({
        db: { "customer-db": { files: [] } },
        auth: { "shop-auth": shopAuth },
        apps,
      }),
      configPath,
    ),
    plugins: [],
  };
}

describe("configApplications", () => {
  test("lists the application of a defineConfig() config with its Auth service", () => {
    const file: LoadedConfigFile = {
      kind: "config",
      config: { ...defineConfig({ name: "shop", auth: shopAuth }), path: configPath },
      plugins: [],
    };

    expect(configApplications(file)).toEqual({
      path: configPath,
      applications: [
        {
          name: "shop",
          authNamespace: "shop-auth",
          oauth2ClientNames: ["web"],
          tailordbNamespaces: undefined,
        },
      ],
      aiGatewayNames: [],
      staticWebsiteNames: [],
    });
  });

  test("lists each application of a workspace config with its Auth service", () => {
    const file = workspaceFile({
      shop: { db: ["customer-db"], auth: "shop-auth" },
      backoffice: { db: ["customer-db"] },
    });

    expect(configApplications(file).applications).toEqual([
      {
        name: "shop",
        authNamespace: "shop-auth",
        oauth2ClientNames: ["web"],
        tailordbNamespaces: ["customer-db"],
      },
      {
        name: "backoffice",
        authNamespace: undefined,
        oauth2ClientNames: [],
        tailordbNamespaces: ["customer-db"],
      },
    ]);
  });
});

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("a workspace config without applications", () => {
  const config = configApplications(workspaceFile({}));

  test("requireApplication suggests adding an application", () => {
    const error = thrownBy(() => requireApplication({ config, name: undefined, option: "--app" }));

    expect(error).toMatchObject({
      code: "CONFIG_APP_REQUIRED",
      message: "The config defines no application.",
      suggestion: "Add an application under apps.",
      context: { applications: [] },
    });
    expect(getErrorDiagnostics(error as Error).location).toEqual({ file: configPath });
  });

  test("selectApplication suggests adding an application for a name", () => {
    const error = thrownBy(() => selectApplication(config, "shop"));

    expect(error).toMatchObject({
      code: "CONFIG_APP_NOT_FOUND",
      message: 'Application "shop" is not defined in the config.',
      suggestion: "Add an application under apps.",
      context: { app: "shop", applications: [] },
    });
    expect(getErrorDiagnostics(error as Error).location).toEqual({ file: configPath });
  });
});
