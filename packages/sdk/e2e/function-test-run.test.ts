/**
 * E2E tests for `function test-run` CLI command
 *
 * Verifies that the function test-run command correctly bundles and executes
 * different function types on the Tailor Platform server via TestExecScript API.
 *
 * Prerequisites:
 * - TAILOR_PLATFORM_TOKEN environment variable must be set
 * - TAILOR_PLATFORM_ORGANIZATION_ID environment variable must be set
 * - packages/sdk must be built (dist/cli/index.mjs must exist)
 *
 * Note: Tests are executed sequentially and share a single workspace.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, beforeAll } from "vitest";
import { initOperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { trackWorkspace, trackTempDir } from "./globalSetup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const E2E_WORKSPACE_PREFIX = "e2e-ws-";
const testRunId = Date.now().toString(36);
const testWorkspaceName = `${E2E_WORKSPACE_PREFIX}${testRunId}`;

const sdkRoot = path.resolve(__dirname, "..");
const cliPath = path.join(sdkRoot, "dist", "cli", "index.mjs");
const exampleDir = path.resolve(sdkRoot, "..", "..", "example");

let workspaceId: string;

interface TestRunResult {
  success: boolean;
  scriptName: string;
  functionType?: string;
  functionName?: string;
  logs: string;
  result: string;
  error?: string;
  exitCode: number;
}

/**
 * Run the function test-run CLI command and return parsed JSON result.
 */
function runTestRun(
  file: string,
  options?: {
    arg?: string;
    name?: string;
    type?: string;
    cwd?: string;
  },
): TestRunResult {
  const cwd = options?.cwd ?? exampleDir;
  const args = [cliPath, "function", "test-run", file, "--json", "--workspace-id", workspaceId];
  if (options?.arg) args.push("--arg", options.arg);
  if (options?.name) args.push("--name", options.name);
  if (options?.type) args.push("--type", options.type);

  try {
    const stdout = execFileSync("node", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_OPTIONS: "--experimental-vm-modules",
      },
      encoding: "utf-8",
      timeout: 120000,
    });
    return { ...JSON.parse(stdout.trim()), exitCode: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    try {
      return { ...JSON.parse((e.stdout ?? "").trim()), exitCode: e.status ?? 1 };
    } catch {
      return {
        success: false,
        scriptName: "",
        logs: "",
        result: "",
        error: e.stderr ?? "Unknown error",
        exitCode: e.status ?? 1,
      };
    }
  }
}

/**
 * Run the apply CLI command.
 */
function runApplyCli(cwd: string): void {
  execFileSync(
    "node",
    [cliPath, "apply", "--config", "tailor.config.ts", "--workspace-id", workspaceId, "--yes"],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_OPTIONS: "--experimental-vm-modules",
      },
      encoding: "utf-8",
      timeout: 120000,
    },
  );
}

describe.sequential("E2E: function test-run", () => {
  beforeAll(async () => {
    if (!process.env.TAILOR_PLATFORM_TOKEN) {
      throw new Error("TAILOR_PLATFORM_TOKEN must be set for E2E tests");
    }

    // Create workspace
    const accessToken = await loadAccessToken({ useProfile: false });
    const client = await initOperatorClient(accessToken);
    const regionsResp = await client.listAvailableWorkspaceRegions({});
    const region = regionsResp.regions[0];

    console.log(`Creating workspace "${testWorkspaceName}" in region "${region}"...`);
    const createResp = await client.createWorkspace({
      workspaceName: testWorkspaceName,
      workspaceRegion: region,
      deleteProtection: false,
      organizationId: process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
      folderId: process.env.TAILOR_PLATFORM_FOLDER_ID,
    });
    workspaceId = createResp.workspace!.id;
    console.log(`Workspace created: ${workspaceId}`);
    trackWorkspace(workspaceId);

    // Redirect SDK type output to temp dir
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fn-test-run-e2e-"));
    trackTempDir(tempDir);
    process.env.TAILOR_PLATFORM_SDK_TYPE_PATH = path.join(tempDir, "user-defined.d.ts");

    // Apply example config to deploy DB schema, auth, machine users
    console.log("Applying example config...");
    runApplyCli(exampleDir);
    console.log("Apply completed.");
  }, 120000);

  describe("resolver", () => {
    test("runs add resolver with input arguments", () => {
      const result = runTestRun("resolvers/add.ts", {
        arg: '{"input":{"a":1,"b":2}}',
      });

      expect(result.success).toBe(true);
      expect(result.functionType).toBe("resolver");
      expect(result.functionName).toBe("add");
      expect(result.scriptName).toContain("add");
      expect(JSON.parse(result.result)).toBe(3);
    });

    test("returns machine user context from userInfo resolver", () => {
      const result = runTestRun("resolvers/userInfo.ts");

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.type).toBe("machine_user");
      expect(parsed.workspaceId).toBe(workspaceId);
      expect(parsed.role).toBe("MANAGER");
      // Machine user ID should be a real UUID (not nil)
      expect(parsed.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(parsed.id).not.toBe("00000000-0000-0000-0000-000000000000");
    });

    test("injects environment variables into resolver", () => {
      const result = runTestRun("resolvers/env.ts", {
        arg: '{"input":{"multiplier":3}}',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.result).toBe(3); // 3 * env.foo (env.foo = 1)
      expect(parsed.envBar).toBe("hello");
      expect(parsed.envBaz).toBe(true);
      // env.ts has console.log("Environment variables:", env)
      expect(result.logs).toContain("Environment variables:");
    });

    test("supports getDB in resolver (stepChain)", () => {
      const result = runTestRun("resolvers/stepChain.ts", {
        arg: '{"input":{"user":{"name":{"first":"John","last":"Doe"}}}}',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.result.summary).toHaveLength(3);
      expect(parsed.result.summary[0]).toContain("Hello John Doe");
      // summary[1] is a date-formatted string
      expect(parsed.result.summary[1]).toMatch(/step2: recorded \d{4}-\d{2}-\d{2}/);
      // summary[2] is the kysely result (may be empty string if no Supplier data)
      expect(typeof parsed.result.summary[2]).toBe("string");
    });

    test("reports validation errors for invalid input", () => {
      const result = runTestRun("resolvers/add.ts", {
        arg: '{"input":{"a":100,"b":2}}',
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("executor", () => {
    test("runs webhook executor with body args", () => {
      const result = runTestRun("executors/testWebhook.ts", {
        arg: '{"body":{"message":"hello"},"headers":{}}',
      });

      expect(result.success).toBe(true);
      expect(result.functionType).toBe("executor");
      expect(result.functionName).toBe("test-webhook");
      expect(result.logs).toContain("Webhook received");
    });
  });

  describe("workflow job", () => {
    test("runs workflow job by name (check-inventory)", () => {
      const result = runTestRun("workflows/sample.ts", {
        name: "check-inventory",
      });

      expect(result.success).toBe(true);
      expect(result.functionType).toBe("workflow-job");
      expect(result.functionName).toBe("check-inventory");
      // check-inventory returns date-formatted string
      const parsed = JSON.parse(result.result);
      expect(parsed).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("pre-bundled .js file", () => {
    test("runs pre-bundled .js file directly", () => {
      // The add resolver was bundled in a previous test, reuse that output
      const bundledPath = ".tailor-sdk/test-run/test-run--add.js";
      expect(fs.existsSync(path.join(exampleDir, bundledPath))).toBe(true);

      const result = runTestRun(bundledPath, {
        arg: '{"input":{"a":5,"b":7}}',
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.result)).toBe(12);
      // Pre-bundled files skip detection, so functionType/functionName are undefined
      expect(result.functionType).toBeUndefined();
    });
  });

  describe("error handling", () => {
    test("separates logs from error in failure output", () => {
      const fixtureDir = path.join(__dirname, "fixtures", "function-test-run");
      const result = runTestRun(path.join(fixtureDir, "error-function.ts"), {
        type: "plain",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      // Logs should contain console.log output
      expect(result.logs).toContain("Log line 1");
      expect(result.logs).toContain("Log line 2");
      // Error should NOT contain log lines (regression test for logs/error duplication)
      if (result.error) {
        expect(result.error).not.toContain("Log line 1");
      }
    });
  });
});
