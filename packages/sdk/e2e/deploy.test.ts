/**
 * E2E tests for service deletion order
 *
 * These tests verify that subgraph services (TailorDB, Pipeline, Auth, IdP)
 * can be deleted without errors. The issue (#570) was that services couldn't
 * be deleted because the Application (gateway) was still referencing them.
 *
 * The fix ensures services are deleted AFTER the Application is deleted.
 *
 * Prerequisites:
 * - Authentication via TAILOR_PLATFORM_TOKEN env var or `tailor login`
 * - TAILOR_PLATFORM_ORGANIZATION_ID environment variable must be set
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, aroundAll, vi } from "vitest";
import { deploy } from "../src/cli/commands/deploy/deploy";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { logger } from "../src/cli/shared/logger";
import {
  resolveE2ERunId,
  resolveE2EWorkspaceRegion,
  trackWorkspace,
  trackTempDir,
} from "./globalSetup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate unique test identifiers (include run id in CI to avoid cross-run cleanup conflicts)
const ciRunId = resolveE2ERunId();
const testRunId = Date.now().toString(36);
const testAppName = `e2e-test-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;

// Shared service names used across tests
const sharedTailordbName = `shared-db-${testRunId}`;

describe("E2E: Service deletion order", () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let configCounter = 0;
  // Share a single auto-generated app id across all configs created in this
  // suite so resources keep being recognized as owned across re-applies, even
  // though each apply targets a different config file (a workaround for
  // Node.js module caching).
  const sharedTestAppId = crypto.randomUUID();

  aroundAll(async (runSuite) => {
    // Initialize client (supports both TAILOR_PLATFORM_TOKEN env var and platform config login)
    const accessToken = await loadAccessToken();
    client = await initOperatorClient(accessToken);

    const region = await resolveE2EWorkspaceRegion(client);

    // Create workspace dynamically
    console.log(`Creating workspace "${testWorkspaceName}" in region "${region}"...`);
    const createResp = await client.createWorkspace({
      workspaceName: testWorkspaceName,
      workspaceRegion: region,
      deleteProtection: false,
      organizationId: process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
      folderId: process.env.TAILOR_PLATFORM_FOLDER_ID,
    });
    workspaceId = createResp.workspace!.id!;
    trackWorkspace(workspaceId);
    console.log(`Workspace created: ${workspaceId}`);

    // Set workspace ID for apply operations
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    // Create temp directory and symlink @tailor-platform/sdk for module resolution
    const sdkRoot = path.resolve(__dirname, "..");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-test-"));
    trackTempDir(tempDir);

    const nodeModulesDir = path.join(tempDir, "node_modules", "@tailor-platform");
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.symlinkSync(sdkRoot, path.join(nodeModulesDir, "sdk"));

    await runSuite();
  }, 120000); // 2 minute timeout for workspace creation

  /**
   * Helper to create a test config file with unique name to avoid Node.js module caching
   * @param config - Config file contents
   * @returns Path to the created config file
   */
  function createTestConfig(config: string): string {
    configCounter++;
    const configPath = path.join(tempDir, `config-${configCounter}.ts`);
    // Inject the shared id at the top of every defineConfig({...}) call so
    // that follow-up applies in the same test still recognize prior resources
    // as owned (see sharedTestAppId comment above).
    const configWithId = config.includes("id:")
      ? config
      : config.replace(/defineConfig\(\{/, `defineConfig({\n  id: "${sharedTestAppId}",`);
    fs.writeFileSync(configPath, configWithId);
    return configPath;
  }

  /**
   * Helper to list all TailorDB service namespaces in the workspace
   * @returns List of TailorDB service namespace names
   */
  async function listTailorDBServiceNames(): Promise<string[]> {
    const services: string[] = [];
    let pageToken = "";
    do {
      const resp = await client.listTailorDBServices({ workspaceId, pageToken });
      for (const svc of resp.tailordbServices) {
        if (svc.namespace?.name) {
          services.push(svc.namespace.name);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return services;
  }

  /**
   * Helper to list all TailorDB table names in a namespace
   * @param namespace - TailorDB namespace name
   * @returns List of table names in the namespace
   */
  async function listTailorDBTypeNames(namespace: string): Promise<string[]> {
    const types: string[] = [];
    let pageToken = "";
    do {
      const resp = await client.listTailorDBTypes({
        workspaceId,
        namespaceName: namespace,
        pageToken,
      });
      for (const t of resp.tailordbTypes) {
        if (t.name) {
          types.push(t.name);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return types;
  }

  /**
   * Helper to list all IdP service names in the workspace
   * @returns List of IdP service namespace names
   */
  async function listIdPServiceNames(): Promise<string[]> {
    const services: string[] = [];
    let pageToken = "";
    do {
      const resp = await client.listIdPServices({ workspaceId, pageToken });
      for (const svc of resp.idpServices) {
        if (svc.namespace?.name) {
          services.push(svc.namespace.name);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return services;
  }

  /**
   * Helper to list all Auth service names in the workspace
   * @returns List of Auth service namespace names
   */
  async function listAuthServiceNames(): Promise<string[]> {
    const services: string[] = [];
    let pageToken = "";
    do {
      const resp = await client.listAuthServices({ workspaceId, pageToken });
      for (const svc of resp.authServices) {
        if (svc.namespace?.name) {
          services.push(svc.namespace.name);
        }
      }
      pageToken = resp.nextPageToken;
    } while (pageToken);
    return services;
  }

  /**
   * Helper to get the absolute path pattern for tailordb files
   * This is needed because file patterns are resolved from process.cwd(), not config file location
   * @returns Absolute path pattern for tailordb files
   */
  function getTailordbFilesPattern(): string {
    return path.join(tempDir, "tailordb", "*.ts").replace(/\\/g, "/");
  }

  /**
   * Helper to get the absolute path pattern for additional tailordb files
   * @returns Absolute path pattern for additional tailordb files
   */
  function getAdditionalTailordbFilesPattern(): string {
    return path.join(tempDir, "extra-tailordb", "*.ts").replace(/\\/g, "/");
  }

  /**
   * Helper to create TailorDB table file
   */
  function createTailorDBTypeFile(): void {
    const tailordbDir = path.join(tempDir, "tailordb");
    fs.mkdirSync(tailordbDir, { recursive: true });
    fs.writeFileSync(
      path.join(tailordbDir, "user.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
    role: db.string({ optional: true }),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`,
    );
  }

  /**
   * Helper to create additional TailorDB table file
   */
  function createAdditionalTailorDBTypeFile(): void {
    const tailordbDir = path.join(tempDir, "extra-tailordb");
    fs.mkdirSync(tailordbDir, { recursive: true });
    fs.writeFileSync(
      path.join(tailordbDir, "extra-user.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const extraUser = db
  .table("ExtraUser", {
    name: db.string(),
    email: db.string(),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);

export type extraUser = typeof extraUser;
`,
    );
  }

  /**
   * Setup test: Create the base application with shared TailorDB
   * This TailorDB will be kept throughout all tests to satisfy the "at least one subgraph" requirement
   */
  test("setup: create base application with shared TailorDB", async () => {
    createTailorDBTypeFile();

    const baseConfig = `
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
  },
});
`;

    const configPath = createTestConfig(baseConfig);
    await deploy({
      workspaceId,
      configPath,
      yes: true,
    });

    // Verify: TailorDB service should exist
    const services = await listTailorDBServiceNames();
    expect(services).toContain(sharedTailordbName);

    // Verify: User table should exist in the namespace
    const types = await listTailorDBTypeNames(sharedTailordbName);
    expect(types).toContain("User");
  }, 120000);

  /**
   * Test: Deleting an additional TailorDB service should not fail
   *
   * This test verifies that a TailorDB service can be deleted when there are
   * other subgraphs remaining in the Application.
   */
  test("should delete additional tailordb service after application is updated", async () => {
    const additionalTailordbName = `extra-db-${testRunId}`;
    createTailorDBTypeFile();
    createAdditionalTailorDBTypeFile();

    // Step 1: Add an additional TailorDB service
    const configWithExtra = `
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
    "${additionalTailordbName}": { files: ["${getAdditionalTailordbFilesPattern()}"] },
  },
});
`;

    const configPath1 = createTestConfig(configWithExtra);
    await deploy({
      workspaceId,
      configPath: configPath1,
      yes: true,
    });

    // Verify: Both TailorDB services should exist
    const servicesAfterAdd = await listTailorDBServiceNames();
    expect(servicesAfterAdd).toContain(sharedTailordbName);
    expect(servicesAfterAdd).toContain(additionalTailordbName);

    // Verify: each TailorDB namespace has its own table
    const typesInShared = await listTailorDBTypeNames(sharedTailordbName);
    expect(typesInShared).toContain("User");
    const typesInAdditional = await listTailorDBTypeNames(additionalTailordbName);
    expect(typesInAdditional).toContain("ExtraUser");

    // Step 2: Remove the additional TailorDB (keep shared one)
    const configWithoutExtra = `
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
  },
});
`;

    const configPath2 = createTestConfig(configWithoutExtra);

    // Step 3: Apply - this should delete the extra TailorDB without error
    await deploy({
      workspaceId,
      configPath: configPath2,
      yes: true,
    });

    // Verify: Additional TailorDB service should be deleted
    const servicesAfterDelete = await listTailorDBServiceNames();
    expect(servicesAfterDelete).toContain(sharedTailordbName);
    expect(servicesAfterDelete).not.toContain(additionalTailordbName);
  }, 120000);

  /**
   * Test: Deleting IdP service should not fail
   */
  test("should delete idp service after application is updated", async () => {
    const idpName = `test-idp-${testRunId}`;

    // Step 1: Add IdP service to the application
    const configWithIdP = `
import {
  defineConfig,
  defineIdp,
  unsafeAllowAllIdPPermission,
} from "@tailor-platform/sdk";

const idp = defineIdp("${idpName}", {
  clients: ["default-idp-client"],
  permission: unsafeAllowAllIdPPermission,
});

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
  },
  idp: [idp],
});
`;

    const configPath1 = createTestConfig(configWithIdP);
    await deploy({
      workspaceId,
      configPath: configPath1,
      yes: true,
    });

    // Verify: IdP service should exist
    const idpServicesAfterAdd = await listIdPServiceNames();
    expect(idpServicesAfterAdd).toContain(idpName);

    // Step 2: Remove IdP from config (keep TailorDB)
    const configWithoutIdP = `
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
  },
});
`;

    const configPath2 = createTestConfig(configWithoutIdP);

    // Step 3: Apply - this should delete IdP without error
    // Before the fix, this would fail with:
    // "Failed to delete IdPService: idp xxx is used by gateway(s)"
    await deploy({
      workspaceId,
      configPath: configPath2,
      yes: true,
    });

    // Verify: IdP service should be deleted
    const idpServicesAfterDelete = await listIdPServiceNames();
    expect(idpServicesAfterDelete).not.toContain(idpName);
  }, 120000);

  /**
   * Test: Deleting Auth service should not fail
   *
   * This test reproduces the original issue (#570) where deleting an Auth
   * service would fail with:
   * "Failed to delete AuthService: auth user-auth is used by gateway(s)"
   *
   * Note: Using Auth without userProfile to avoid SDL composition issues
   * with dynamic config generation.
   */
  test("should delete auth service after application is updated", async () => {
    const authName = `test-auth-${testRunId}`;
    const idpName = `test-idp-auth-${testRunId}`;

    // Step 1: Add Auth service (without userProfile to avoid SDL composition issues)
    const configWithAuth = `
import {
  defineConfig,
  defineAuth,
  defineIdp,
  unsafeAllowAllIdPPermission,
} from "@tailor-platform/sdk";

const idp = defineIdp("${idpName}", {
  clients: ["default-idp-client"],
  permission: unsafeAllowAllIdPPermission,
});

const auth = defineAuth("${authName}", {
  idProvider: idp.provider("default", "default-idp-client"),
});

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
  },
  idp: [idp],
  auth,
});
`;

    const configPath1 = createTestConfig(configWithAuth);
    await deploy({
      workspaceId,
      configPath: configPath1,
      yes: true,
    });

    // Verify: Auth and IdP services should exist
    const authServicesAfterAdd = await listAuthServiceNames();
    expect(authServicesAfterAdd).toContain(authName);
    const idpServicesAfterAdd = await listIdPServiceNames();
    expect(idpServicesAfterAdd).toContain(idpName);

    // Step 2: Remove Auth from config (keep TailorDB and IdP)
    const configWithoutAuth = `
import {
  defineConfig,
  defineIdp,
  unsafeAllowAllIdPPermission,
} from "@tailor-platform/sdk";

const idp = defineIdp("${idpName}", {
  clients: ["default-idp-client"],
  permission: unsafeAllowAllIdPPermission,
});

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
  },
  idp: [idp],
});
`;

    const configPath2 = createTestConfig(configWithoutAuth);

    // Step 3: Apply - this should delete Auth without error
    // Before the fix, this would fail with:
    // "Failed to delete AuthService: auth xxx is used by gateway(s)"
    await deploy({
      workspaceId,
      configPath: configPath2,
      yes: true,
    });

    // Verify: Auth service should be deleted, IdP should remain
    const authServicesAfterDelete = await listAuthServiceNames();
    expect(authServicesAfterDelete).not.toContain(authName);
    const idpServicesAfterDelete = await listIdPServiceNames();
    expect(idpServicesAfterDelete).toContain(idpName);
  }, 120000);

  /**
   * Test: --no-schema-check option should skip schema validation
   *
   * This test verifies that the --no-schema-check flag properly skips
   * schema diff validation against migration snapshots.
   */
  test("should skip schema check with --no-schema-check option", async () => {
    // Create a config with migrations enabled
    const migrationsDir = path.join(tempDir, "migrations");
    fs.mkdirSync(migrationsDir, { recursive: true });

    // Create initial snapshot (0000/schema.json)
    const initialSnapshotDir = path.join(migrationsDir, "0000");
    fs.mkdirSync(initialSnapshotDir, { recursive: true });
    fs.writeFileSync(
      path.join(initialSnapshotDir, "schema.json"),
      JSON.stringify({
        version: 2,
        namespace: sharedTailordbName,
        createdAt: new Date().toISOString(),
        types: {
          User: {
            name: "User",
            fields: {
              name: { type: "string", required: true },
              email: { type: "string", required: true },
              role: { type: "string", required: false },
            },
          },
        },
      }),
    );

    // Update table file to add a new field (causing schema diff)
    const tailordbDir = path.join(tempDir, "tailordb");
    fs.writeFileSync(
      path.join(tailordbDir, "user.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
    role: db.string({ optional: true }),
    newField: db.string({ optional: true }), // New field added
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`,
    );

    const configWithMigrations = `
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": {
      files: ["${getTailordbFilesPattern()}"],
      migration: {
        directory: "${migrationsDir.replace(/\\/g, "\\\\")}",
      },
    },
  },
});
`;

    const configPath = createTestConfig(configWithMigrations);

    // Without --no-schema-check, this should fail due to schema diff
    await expect(
      deploy({
        workspaceId,
        configPath,
        yes: true,
        noSchemaCheck: false,
      }),
    ).rejects.toThrow(/Schema migration check failed/);

    // With --no-schema-check, this should succeed despite schema diff
    await expect(
      deploy({
        workspaceId,
        configPath,
        yes: true,
        noSchemaCheck: true,
      }),
    ).resolves.not.toThrow();

    // Reset user table file to original state for cleanup
    fs.writeFileSync(
      path.join(tailordbDir, "user.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
    role: db.string({ optional: true }),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`,
    );
  }, 120000);

  /**
   * Cleanup test: Keep only the shared TailorDB
   */
  test("cleanup: remove remaining services", async () => {
    const cleanupConfig = `
import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { files: ["${getTailordbFilesPattern()}"] },
  },
});
`;

    const configPath = createTestConfig(cleanupConfig);
    await expect(
      deploy({
        workspaceId,
        configPath,
        yes: true,
      }),
    ).resolves.toBeUndefined();
  }, 120000);
});

describe("E2E: static website env reference created in the same deploy", () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;

  aroundAll(async (runSuite) => {
    const accessToken = await loadAccessToken();
    client = await initOperatorClient(accessToken);
    const region = await resolveE2EWorkspaceRegion(client);

    const workspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}-static-env`;
    const createResp = await client.createWorkspace({
      workspaceName,
      workspaceRegion: region,
      deleteProtection: false,
      organizationId: process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
      folderId: process.env.TAILOR_PLATFORM_FOLDER_ID,
    });
    workspaceId = createResp.workspace!.id!;
    trackWorkspace(workspaceId);

    const sdkRoot = path.resolve(__dirname, "..");
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-static-env-"));
    trackTempDir(tempDir);
    const nodeModulesDir = path.join(tempDir, "node_modules", "@tailor-platform");
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.symlinkSync(sdkRoot, path.join(nodeModulesDir, "sdk"));

    await runSuite();
  }, 120000);

  test("resolves a static website `env` reference created by the same deploy, in one deploy() call", async () => {
    const siteName = `e2e-site-${testRunId}`;
    const appName = `e2e-static-env-${testRunId}`;
    const configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(
      configPath,
      `
import { defineConfig, defineStaticWebSite } from "@tailor-platform/sdk";

const website = defineStaticWebSite("${siteName}", { description: "auto-redeploy e2e" });

export default defineConfig({
  name: "${appName}",
  staticWebsites: [website],
  env: { siteUrl: website.url },
});
`,
    );

    const warnMessages: string[] = [];
    const infoMessages: string[] = [];
    using _warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation((message: string) => void warnMessages.push(message));
    using _infoSpy = vi
      .spyOn(logger, "info")
      .mockImplementation((message: string) => void infoMessages.push(message));

    await expect(deploy({ workspaceId, configPath, yes: true })).resolves.toBeUndefined();

    // Left unresolved during the first pass, because the site does not exist
    // yet at that pass's plan time -- expected, not a failure.
    expect(
      warnMessages.some((message) => message.includes("is created later in this deploy")),
    ).toBe(true);
    // The single deploy() call announces and runs the automatic rebuild, so
    // the placeholder does not need a second, human-triggered `deploy`.
    expect(infoMessages.some((message) => message.includes("rebuilding so env resolves"))).toBe(
      true,
    );
    // Exactly one occurrence: left unresolved on the first build, resolved for
    // real on the rebuild. A regression that keeps failing to resolve would
    // log this warning again on the rebuild.
    expect(
      warnMessages.filter((message) => message.includes("keeps the unresolved value")),
    ).toHaveLength(1);

    const site = await client.getStaticWebsite({ workspaceId, name: siteName });
    expect(site.staticwebsite?.url).toBeTruthy();
  }, 180000);
});
