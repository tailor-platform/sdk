import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import {
  brandedDefault,
  WORKSPACE_DB_SOURCE,
  writeWorkspaceTables,
} from "#/cli/shared/test-helpers/workspace-config";
import {
  assertHttpAdaptersHaveOneApplication,
  buildDeploymentTargets,
  loadDeployConfigs,
} from "./deployment-target";

const WORKSPACE_CONFIG = brandedDefault(
  "workspace-config",
  `{ db: { main: { files: [] } }, apps: { shop: { db: ["main"] } } }`,
);

function writeConfig(dir: string, name: string, source: string): string {
  const file = path.join(dir, name, "tailor.config.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}

describe("loadDeployConfigs", () => {
  test("loads a workspace config without resolving an application id", async () => {
    using dir = tempDir("deploy-workspace-config-");
    using _logger = silenceLogger("warn", "log");
    fs.mkdirSync(path.join(dir.dir, ".git"));
    fs.mkdirSync(path.join(dir.dir, ".github"));
    const lock = JSON.stringify({ version: 2, targets: [], appIds: {} });
    fs.writeFileSync(path.join(dir.dir, ".github", "tailor.lock"), lock);
    const configPath = writeConfig(dir.dir, "ws", WORKSPACE_CONFIG);

    const [loaded] = await loadDeployConfigs({
      configPaths: [configPath],
      dryRun: false,
      buildOnly: false,
    });

    expect(loaded).toMatchObject({ kind: "workspace", workspace: { path: configPath } });
    expect(fs.readFileSync(configPath, "utf-8")).toBe(WORKSPACE_CONFIG);
    expect(fs.readFileSync(path.join(dir.dir, ".github", "tailor.lock"), "utf-8")).toBe(lock);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("rejects a workspace config deployed together with other configs", async () => {
    using dir = tempDir("deploy-workspace-config-");
    const workspacePath = writeConfig(dir.dir, "ws", WORKSPACE_CONFIG);
    const appPath = writeConfig(
      dir.dir,
      "app",
      `export default { id: "8d6f1e2a-4b3c-4d5e-9f60-7a8b9c0d1e2f", name: "other" };`,
    );

    await expect(
      loadDeployConfigs({ configPaths: [appPath, workspacePath], dryRun: true, buildOnly: false }),
    ).rejects.toMatchObject({
      code: "DEPLOY_WORKSPACE_CONFIG_WITH_OTHERS",
      context: { configPath: workspacePath },
    });
  });
});

describe("assertHttpAdaptersHaveOneApplication", () => {
  const app = (name: string) => ({ name, subgraphs: [], authNamespace: undefined, settings: {} });
  const services = (adapterCount: number) => ({
    httpAdapterService: {
      adapters: Array.from({ length: adapterCount }, (_, index) => ({ name: `a${index}` })),
    },
  });

  test("rejects HTTP adapters in a workspace config that deploys no application", () => {
    expect(() => assertHttpAdaptersHaveOneApplication(services(1) as never, [])).toThrow(
      expect.objectContaining({
        code: "HTTP_ADAPTER_MULTIPLE_APPLICATIONS",
        context: { applications: [] },
      }),
    );
  });

  test.for([
    { label: "HTTP adapters with one application", adapters: 1, apps: ["shop"] },
    { label: "several applications without HTTP adapters", adapters: 0, apps: ["shop", "admin"] },
  ])("accepts $label", ({ adapters, apps }) => {
    expect(() =>
      assertHttpAdaptersHaveOneApplication(services(adapters) as never, apps.map(app)),
    ).not.toThrow();
  });
});

describe("buildDeploymentTargets for a workspace config", () => {
  // Inside the package, so the config's imports resolve `@tailor-platform/sdk`.
  function packageTempDir(): Disposable & { readonly dir: string } {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-target-")),
    );
    return { dir, [Symbol.dispose]: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  function buildTargets(dir: string, configPath: string) {
    return buildDeploymentTargets({
      configPaths: [configPath],
      dryRun: true,
      buildOnly: true,
      noCache: true,
      packageVersion: "test",
      cacheDir: path.join(dir, ".cache"),
    });
  }

  test("builds one target for the whole workspace with its applications and env overrides", async () => {
    using workspace = packageTempDir();
    const { dir } = workspace;
    writeWorkspaceTables(
      dir,
      (name) => `import {
  db,
  unsafeAllowAllGqlPermission,
  unsafeAllowAllTypePermission,
} from "@tailor-platform/sdk";
export const table = db
  .table("${name}", { name: db.string() })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);
`,
    );
    const auth = (name: string, machineUser: string) => `defineAuth("${name}", {
        machineUserAttributes: { role: db.string() },
        machineUsers: { ${machineUser}: { attributes: { role: "ADMIN" } } },
      })`;
    const configPath = path.join(dir, "tailor.config.ts");
    fs.writeFileSync(
      configPath,
      `import { db, defineAuth } from "@tailor-platform/sdk";

${brandedDefault(
  "workspace-config",
  `{
  env: { tier: "root" },
  db: ${WORKSPACE_DB_SOURCE},
  resolver: { "shop-api": { files: [], env: { tier: "api" } } },
  auth: { "shop-auth": ${auth("shop-auth", "admin")}, "admin-auth": ${auth("admin-auth", "batch")} },
  apps: {
    shop: { db: ["customer-db", "order-db"], resolver: ["shop-api"], auth: "shop-auth" },
    admin: { db: ["order-db"], auth: "admin-auth" },
  },
}`,
)}
`,
    );

    const [target] = await buildTargets(dir, configPath);

    expect(target).toMatchObject({
      source: { kind: "workspace", workspace: { path: configPath } },
      owner: { kind: "workspace" },
      envOverrides: { resolver: { "shop-api": { tier: "api" } } },
    });
    expect(
      target?.applications.map(({ name, authNamespace }) => ({ name, authNamespace })),
    ).toEqual([
      { name: "shop", authNamespace: "shop-auth" },
      { name: "admin", authNamespace: "admin-auth" },
    ]);
    expect(target?.application.authServices.map(({ config }) => config.name)).toEqual([
      "shop-auth",
      "admin-auth",
    ]);
    expect(fs.readFileSync(path.join(dir, "tailor.d.ts"), "utf-8")).toContain('"admin-auth": true');
  });

  test("rejects HTTP adapters in a workspace config with several applications", async () => {
    using workspace = packageTempDir();
    const { dir } = workspace;
    fs.mkdirSync(path.join(dir, "adapters"));
    fs.writeFileSync(
      path.join(dir, "adapters", "adapter.ts"),
      `import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "adapter",
  pathPattern: "/a",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );
    const configPath = path.join(dir, "tailor.config.ts");
    fs.writeFileSync(
      configPath,
      brandedDefault(
        "workspace-config",
        `{
  db: { main: { files: [] } },
  httpAdapter: { files: ["./adapters/*.ts"] },
  apps: { shop: { db: ["main"] }, admin: { db: ["main"] } },
}`,
      ),
    );

    await expect(buildTargets(dir, configPath)).rejects.toMatchObject({
      code: "HTTP_ADAPTER_MULTIPLE_APPLICATIONS",
      context: { applications: ["shop", "admin"] },
    });
  });
});
