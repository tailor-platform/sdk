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
 * - TAILOR_PLATFORM_TOKEN environment variable must be set
 * - TAILOR_PLATFORM_ORGANIZATION_ID environment variable must be set
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { initOperatorClient, type OperatorClient } from "../client";
import { loadAccessToken } from "../context";
import { apply } from "./index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate unique test app name to avoid conflicts
const testRunId = Date.now().toString(36);
const testAppName = `e2e-test-${testRunId}`;
const testWorkspaceName = `e2e-ws-${testRunId}`;

// Shared service names used across tests
const sharedTailordbName = `shared-db-${testRunId}`;

describe("E2E: Service deletion order", () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let configCounter = 0;

  beforeAll(async () => {
    // Check for required environment variable
    if (!process.env.TAILOR_PLATFORM_TOKEN) {
      throw new Error(
        "TAILOR_PLATFORM_TOKEN environment variable must be set to run E2E tests",
      );
    }

    // Initialize client
    const accessToken = await loadAccessToken({ useProfile: false });
    client = await initOperatorClient(accessToken);

    // Get available regions and use the first one
    const regionsResp = await client.listAvailableWorkspaceRegions({});
    const region = regionsResp.regions[0];
    if (!region) {
      throw new Error("No available regions found");
    }

    // Create workspace dynamically
    console.log(
      `Creating workspace "${testWorkspaceName}" in region "${region}"...`,
    );
    const createResp = await client.createWorkspace({
      workspaceName: testWorkspaceName,
      workspaceRegion: region,
      deleteProtection: false,
      organizationId: process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
      folderId: process.env.TAILOR_PLATFORM_FOLDER_ID,
    });
    workspaceId = createResp.workspace!.id!;
    console.log(`Workspace created: ${workspaceId}`);

    // Set workspace ID for apply operations
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    // Create temp directory inside SDK package so @tailor-platform/sdk can be resolved
    // Go up from src/cli/apply to packages/sdk (3 levels: apply -> cli -> src -> sdk)
    const sdkRoot = path.resolve(__dirname, "../../..");
    tempDir = path.join(sdkRoot, `.e2e-test-${testRunId}`);
    fs.mkdirSync(tempDir, { recursive: true });
  }, 120000); // 2 minute timeout for workspace creation

  afterAll(async () => {
    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // Delete workspace
    if (client && workspaceId) {
      console.log(`Deleting workspace "${workspaceId}"...`);
      try {
        await client.deleteWorkspace({ workspaceId });
        console.log("Workspace deleted successfully.");
      } catch (error) {
        console.error("Failed to delete workspace:", error);
      }
    }
  }, 120000); // 2 minute timeout for workspace deletion

  /**
   * Helper to create a test config file with unique name to avoid Node.js module caching
   */
  function createTestConfig(config: string): string {
    configCounter++;
    const configPath = path.join(tempDir, `config-${configCounter}.ts`);
    fs.writeFileSync(configPath, config);
    return configPath;
  }

  /**
   * Helper to create TailorDB type file
   */
  function createTailorDBTypeFile(): void {
    const tailordbDir = path.join(tempDir, "tailordb");
    fs.mkdirSync(tailordbDir, { recursive: true });
    fs.writeFileSync(
      path.join(tailordbDir, "user.ts"),
      `
import { db } from "@tailor-platform/sdk";

export const user = db.type("User", {
  name: db.string(),
  email: db.string(),
  role: db.string({ optional: true }),
});

export type user = typeof user;
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
import { user } from "./tailordb/user";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
  },
});
`;

    const configPath = createTestConfig(baseConfig);
    await apply({
      workspaceId,
      configPath,
      yes: true,
    });
  }, 120000);

  /**
   * Test: Deleting an additional TailorDB service should not fail
   *
   * This test verifies that a TailorDB service can be deleted when there are
   * other subgraphs remaining in the Application.
   */
  test("should delete additional tailordb service after application is updated", async () => {
    const additionalTailordbName = `extra-db-${testRunId}`;

    // Step 1: Add an additional TailorDB service
    const configWithExtra = `
import { defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
    "${additionalTailordbName}": { types: [user] },
  },
});
`;

    const configPath1 = createTestConfig(configWithExtra);
    await apply({
      workspaceId,
      configPath: configPath1,
      yes: true,
    });

    // Step 2: Remove the additional TailorDB (keep shared one)
    const configWithoutExtra = `
import { defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
  },
});
`;

    const configPath2 = createTestConfig(configWithoutExtra);

    // Step 3: Apply - this should delete the extra TailorDB without error
    await expect(
      apply({
        workspaceId,
        configPath: configPath2,
        yes: true,
      }),
    ).resolves.not.toThrow();
  }, 120000);

  /**
   * Test: Deleting IdP service should not fail
   */
  test("should delete idp service after application is updated", async () => {
    const idpName = `test-idp-${testRunId}`;

    // Step 1: Add IdP service to the application
    const configWithIdP = `
import { defineConfig, defineIdp } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const idp = defineIdp("${idpName}", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
});

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
  },
  idp: [idp],
});
`;

    const configPath1 = createTestConfig(configWithIdP);
    await apply({
      workspaceId,
      configPath: configPath1,
      yes: true,
    });

    // Step 2: Remove IdP from config (keep TailorDB)
    const configWithoutIdP = `
import { defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
  },
});
`;

    const configPath2 = createTestConfig(configWithoutIdP);

    // Step 3: Apply - this should delete IdP without error
    // Before the fix, this would fail with:
    // "Failed to delete IdPService: idp xxx is used by gateway(s)"
    await expect(
      apply({
        workspaceId,
        configPath: configPath2,
        yes: true,
      }),
    ).resolves.not.toThrow();
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
import { defineConfig, defineAuth, defineIdp } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const idp = defineIdp("${idpName}", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
});

const auth = defineAuth("${authName}", {
  idProvider: idp.provider("default", "default-idp-client"),
});

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
  },
  idp: [idp],
  auth,
});
`;

    const configPath1 = createTestConfig(configWithAuth);
    await apply({
      workspaceId,
      configPath: configPath1,
      yes: true,
    });

    // Step 2: Remove Auth from config (keep TailorDB and IdP)
    const configWithoutAuth = `
import { defineConfig, defineIdp } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

const idp = defineIdp("${idpName}", {
  authorization: "loggedIn",
  clients: ["default-idp-client"],
});

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
  },
  idp: [idp],
});
`;

    const configPath2 = createTestConfig(configWithoutAuth);

    // Step 3: Apply - this should delete Auth without error
    // Before the fix, this would fail with:
    // "Failed to delete AuthService: auth xxx is used by gateway(s)"
    await expect(
      apply({
        workspaceId,
        configPath: configPath2,
        yes: true,
      }),
    ).resolves.not.toThrow();
  }, 120000);

  /**
   * Cleanup test: Keep only the shared TailorDB
   */
  test("cleanup: remove remaining services", async () => {
    const cleanupConfig = `
import { defineConfig } from "@tailor-platform/sdk";
import { user } from "./tailordb/user";

export default defineConfig({
  name: "${testAppName}",
  db: {
    "${sharedTailordbName}": { types: [user] },
  },
});
`;

    const configPath = createTestConfig(cleanupConfig);
    await apply({
      workspaceId,
      configPath,
      yes: true,
    });
  }, 120000);
});
