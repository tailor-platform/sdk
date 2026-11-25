import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import { assertResourcesFromOwnConfig, type OwnConfigGuardPlan } from "./define-app-guard";
import type { WorkspaceTakeover } from "./confirm";
import type { DeploymentSource } from "./deployment-target";

const SHOP_ID = "8d6f1e2a-4b3c-4d5e-9f60-7a8b9c0d1e2f";
const ADMIN_ID = "0191b0f4-1c4e-7d3a-9f2b-8c5a4e6d7b81";
const MERGE_SUGGESTION =
  "Merge every config deployed to this workspace into one defineWorkspace() config and deploy that instead: it takes over their resources.";
const REMOVE_SUGGESTION =
  "If a config whose resources would be taken over is no longer needed, delete its resources first with `tailor remove -c <that config>`.";
const RECORD_ID_SUGGESTION = `If a listed application is this config's, set "tailor.config.ts" under 'appIds' in .github/tailor.lock to its id.`;
const RENAME_SUGGESTION =
  "If a listed application is this config's under an earlier name, deploy this config once as a defineWorkspace() config whose apps list the new name: it deletes every application in the workspace that it does not list.";

function source(configPath: string, definedBy: "defineApp" | "defineWorkspace"): DeploymentSource {
  return { kind: "workspace", workspace: { path: configPath, definedBy } } as DeploymentSource;
}
function takeover(
  name: string,
  currentOwner: string,
  currentAppId?: string,
  resourceType: WorkspaceTakeover["resourceType"] = "pipeline.service",
): WorkspaceTakeover {
  return {
    resourceType,
    resourceName: name,
    resourceLabel: "Resolver namespace",
    action: "delete",
    currentOwner,
    ...(currentAppId && { currentAppId }),
  };
}
function plan(
  takeovers: WorkspaceTakeover[],
  applicationDeletes: string[] = [],
): OwnConfigGuardPlan {
  return {
    applications: [{ name: "shop" }],
    takeovers,
    applicationDeletes: applicationDeletes.map((name) => ({ name })),
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

describe("assertResourcesFromOwnConfig", () => {
  test("lets a defineApp() config take over the resources of the id its lock entry records", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("shop-api", "shop", SHOP_ID)]),
      ),
    ).not.toThrow();
  });

  test("stops a defineApp() config that would take over another config's resources", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("shop-api", "shop", SHOP_ID), takeover("admin-api", "admin", ADMIN_ID)]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        message: `This defineApp() config would take over resources that another config deployed: "admin" (${ADMIN_ID}).`,
        suggestion: [MERGE_SUGGESTION, REMOVE_SUGGESTION, RECORD_ID_SUGGESTION].join(" "),
        context: {
          configPath,
          takenOverApplications: [
            {
              id: ADMIN_ID,
              name: "admin",
              resources: [{ resourceType: "pipeline.service", name: "admin-api" }],
            },
          ],
          deletedApplications: [],
        },
      }),
    );
  });

  test("without a lock entry, takes the only id it finds as its own when it carries this config's name", () => {
    const { dir, configPath } = repository();
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([
          takeover("shop-api", "shop", SHOP_ID),
          takeover("shop-db", "shop", SHOP_ID),
          takeover("legacy-api", "shop"),
        ]),
      ),
    ).not.toThrow();
  });

  test("without a lock, stops at the only id it finds when it carries another name", () => {
    const { dir, configPath } = repository();
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan(
          [
            takeover("billing-api", "billing", ADMIN_ID),
            takeover("billing", "billing", ADMIN_ID, "application"),
          ],
          ["billing"],
        ),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        message: `This defineApp() config would take over resources that another config deployed: "billing" (${ADMIN_ID}).`,
        suggestion: [MERGE_SUGGESTION, REMOVE_SUGGESTION, RENAME_SUGGESTION].join(" "),
        context: {
          configPath,
          takenOverApplications: [
            {
              id: ADMIN_ID,
              name: "billing",
              resources: [
                { resourceType: "pipeline.service", name: "billing-api" },
                { resourceType: "application", name: "billing" },
              ],
            },
          ],
          deletedApplications: [],
        },
      }),
    );
  });

  test("without a lock entry, suggests recording the id of the only one it finds under another name", () => {
    const { dir, configPath } = repository({});
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("billing-api", "billing", ADMIN_ID)]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        suggestion: [MERGE_SUGGESTION, REMOVE_SUGGESTION, RECORD_ID_SUGGESTION].join(" "),
      }),
    );
  });

  test("stops at resources without an id that another application's name marks", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([
          takeover("shop-api", "shop", SHOP_ID),
          takeover("shop-db", "shop"),
          takeover("legacy-api", "legacy"),
        ]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        message:
          'This defineApp() config would take over resources that another config deployed: "legacy".',
        suggestion: [MERGE_SUGGESTION, REMOVE_SUGGESTION, RENAME_SUGGESTION].join(" "),
        context: {
          configPath,
          takenOverApplications: [
            {
              name: "legacy",
              resources: [{ resourceType: "pipeline.service", name: "legacy-api" }],
            },
          ],
          deletedApplications: [],
        },
      }),
    );
  });

  test("lists resources with another id and without one, suggesting both remedies", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("admin-api", "admin", ADMIN_ID), takeover("legacy-api", "legacy")]),
      ),
    ).toThrow(
      expect.objectContaining({
        message: `This defineApp() config would take over resources that several configs deployed: "admin" (${ADMIN_ID}), "legacy".`,
        suggestion: [
          MERGE_SUGGESTION,
          REMOVE_SUGGESTION,
          RECORD_ID_SUGGESTION,
          RENAME_SUGGESTION,
        ].join(" "),
      }),
    );
  });

  test("without a lock entry, stops when it finds two ids", () => {
    const { dir, configPath } = repository({});
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("shop-api", "shop", SHOP_ID), takeover("admin-api", "admin", ADMIN_ID)]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        message: `This defineApp() config would take over resources that several configs deployed: "shop" (${SHOP_ID}), "admin" (${ADMIN_ID}).`,
        context: expect.objectContaining({
          takenOverApplications: [
            expect.objectContaining({ id: SHOP_ID }),
            expect.objectContaining({ id: ADMIN_ID }),
          ],
        }),
      }),
    );
  });

  test("stops a defineApp() config that would delete another workspace config's application", () => {
    const { dir, configPath } = repository();
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("billing", "shop")], ["billing"]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "DEPLOY_OTHER_CONFIG_RESOURCES",
        message:
          'This defineApp() config would delete applications it does not deploy, which another defineApp() or defineWorkspace() config may own: "billing".',
        suggestion: expect.stringContaining("this config's under an earlier name"),
        context: { configPath, takenOverApplications: [], deletedApplications: ["billing"] },
      }),
    );
  });

  test("names both the resources it would take over and the applications it would delete", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("admin-api", "admin", ADMIN_ID)], ["billing"]),
      ),
    ).toThrow(
      expect.objectContaining({
        message: [
          `This defineApp() config would take over resources that another config deployed: "admin" (${ADMIN_ID}).`,
          'This defineApp() config would delete applications it does not deploy, which another defineApp() or defineWorkspace() config may own: "billing".',
        ].join("\n"),
        context: {
          configPath,
          takenOverApplications: [expect.objectContaining({ id: ADMIN_ID })],
          deletedApplications: ["billing"],
        },
      }),
    );
  });

  test("lets a defineApp() config delete its own application and one it takes over", () => {
    const { dir, configPath } = repository({ "tailor.config.ts": SHOP_ID });
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineApp"),
        plan([takeover("legacy", "legacy", SHOP_ID, "application")], ["shop", "legacy"]),
      ),
    ).not.toThrow();
  });

  test("leaves a defineWorkspace() config to take over and delete every config's resources", () => {
    const { dir, configPath } = repository();
    using _dir = dir;

    expect(() =>
      assertResourcesFromOwnConfig(
        source(configPath, "defineWorkspace"),
        plan(
          [takeover("shop-api", "shop", SHOP_ID), takeover("admin-api", "admin", ADMIN_ID)],
          ["billing"],
        ),
      ),
    ).not.toThrow();
  });
});
