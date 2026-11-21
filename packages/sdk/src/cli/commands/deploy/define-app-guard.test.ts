import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import { assertTakeoversFromOwnConfig } from "./define-app-guard";
import type { WorkspaceTakeover } from "./confirm";
import type { DeploymentSource } from "./deployment-target";

const SHOP_ID = "8d6f1e2a-4b3c-4d5e-9f60-7a8b9c0d1e2f";
const ADMIN_ID = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";

function source(configPath: string, definedBy: "defineApp" | "defineWorkspace"): DeploymentSource {
  return { kind: "workspace", workspace: { path: configPath, definedBy } } as DeploymentSource;
}
function takeover(name: string, currentOwner: string, currentAppId?: string): WorkspaceTakeover {
  return {
    resourceType: "pipeline.service",
    resourceName: name,
    resourceLabel: "Resolver namespace",
    action: "delete",
    currentOwner,
    ...(currentAppId && { currentAppId }),
  };
}
function repository(appIds?: Record<string, string>) {
  const dir = tempDir("define-app-guard-");
  fs.mkdirSync(path.join(dir.dir, ".git"));
  if (appIds) {
    fs.mkdirSync(path.join(dir.dir, ".github"));
    fs.writeFileSync(
      path.join(dir.dir, ".github", "tailor.lock"),
      JSON.stringify({ version: 2, targets: [], appIds }),
    );
  }
  return { dir, configPath: path.join(dir.dir, "tailor.config.ts") };
}

describe("assertTakeoversFromOwnConfig", () => {
  test("lets a defineApp() config take over the resources of the id its lock entry records", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertTakeoversFromOwnConfig(source(configPath, "defineApp"), [
        takeover("shop-api", "shop", SHOP_ID),
      ]),
    ).not.toThrow();
  });

  test("stops a defineApp() config that would take over another config's resources", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertTakeoversFromOwnConfig(source(configPath, "defineApp"), [
        takeover("shop-api", "shop", SHOP_ID),
        takeover("admin-api", "admin", ADMIN_ID),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        message: expect.stringContaining(`"admin" (${ADMIN_ID})`),
        context: {
          configPath,
          applications: [
            {
              id: ADMIN_ID,
              name: "admin",
              resources: [{ resourceType: "pipeline.service", name: "admin-api" }],
            },
          ],
        },
      }),
    );
  });

  test("without a lock entry, takes the only id it finds as its own", () => {
    const { dir, configPath } = repository();
    using _dir = dir;

    expect(() =>
      assertTakeoversFromOwnConfig(source(configPath, "defineApp"), [
        takeover("shop-api", "shop", SHOP_ID),
        takeover("shop-db", "shop", SHOP_ID),
        takeover("legacy-api", "legacy"),
      ]),
    ).not.toThrow();
  });

  test("without a lock entry, stops when it finds two ids", () => {
    const { dir, configPath } = repository({});
    using _dir = dir;

    expect(() =>
      assertTakeoversFromOwnConfig(source(configPath, "defineApp"), [
        takeover("shop-api", "shop", SHOP_ID),
        takeover("admin-api", "admin", ADMIN_ID),
      ]),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        context: expect.objectContaining({
          applications: [
            expect.objectContaining({ id: SHOP_ID }),
            expect.objectContaining({ id: ADMIN_ID }),
          ],
        }),
      }),
    );
  });

  test("leaves a defineWorkspace() config to take over every config's resources", () => {
    const { dir, configPath } = repository();
    using _dir = dir;

    expect(() =>
      assertTakeoversFromOwnConfig(source(configPath, "defineWorkspace"), [
        takeover("shop-api", "shop", SHOP_ID),
        takeover("admin-api", "admin", ADMIN_ID),
      ]),
    ).not.toThrow();
  });
});
