/**
 * E2E tests for `function test-run` CLI command
 *
 * Verifies that the function test-run command correctly bundles and executes
 * different function types on the Tailor Platform server via TestExecScript API.
 *
 * Uses internal APIs directly (detectFunctionType, bundleForTestRun, executeScript)
 * instead of spawning CLI subprocesses. The deploy step still uses subprocess
 * since it orchestrates multiple services.
 *
 * Prerequisites:
 * - Authentication via TAILOR_PLATFORM_TOKEN env var or `tailor-sdk login`
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
import { create } from "@bufbuild/protobuf";
import { AuthInvokerSchema, type AuthInvoker } from "@tailor-proto/tailor/v1/auth_resource_pb";
import { describe, test, expect, beforeAll } from "vitest";
import { bundleForTestRun, type ResolvedMachineUser } from "../src/cli/commands/function/bundle";
import { detectFunctionType } from "../src/cli/commands/function/detect";
import { initOperatorClient, type OperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { executeScript, type ScriptExecutionResult } from "../src/cli/shared/script-executor";
import { resolveE2ERunId, resolveE2EWorkspaceRegion, trackWorkspace } from "./globalSetup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const E2E_WORKSPACE_PREFIX = "e2e-ws-";
const ciRunId = resolveE2ERunId();
const testRunId = Date.now().toString(36);
const testWorkspaceName = `${E2E_WORKSPACE_PREFIX}${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;

const sdkRoot = path.resolve(__dirname, "..");
const cliPath = path.join(sdkRoot, "dist", "cli", "index.mjs");
const exampleDir = path.resolve(sdkRoot, "..", "..", "example");

let workspaceId: string;
let client: OperatorClient;
let authInvoker: AuthInvoker;
let machineUser: ResolvedMachineUser;
const env = { foo: 1, bar: "hello", baz: true };
const AUTH_NAMESPACE = "my-auth";
const MACHINE_USER_NAME = "manager-machine-user";

interface TestRunResult extends ScriptExecutionResult {
  scriptName: string;
  functionType?: string;
  functionName?: string;
}

// Bundle and execute a function file via internal APIs.
async function runTestRun(
  file: string,
  options?: {
    arg?: string;
    name?: string;
  },
): Promise<TestRunResult> {
  const filePath = path.resolve(exampleDir, file);

  if (filePath.endsWith(".js")) {
    const code = fs.readFileSync(filePath, "utf-8");
    const scriptName = path.basename(filePath);
    const result = await executeScript({
      client,
      workspaceId,
      name: scriptName,
      code,
      arg: options?.arg === undefined ? undefined : JSON.parse(options.arg),
      invoker: authInvoker,
    });
    return { ...result, scriptName };
  }

  const detected = await detectFunctionType({
    filePath,
    jobName: options?.name,
  });

  let resolvedArg = options?.arg;
  if (detected.type === "resolver" && resolvedArg && !detected.hasInput) {
    resolvedArg = undefined;
  }

  const { bundledCode, scriptName } = await bundleForTestRun({
    detected,
    sourceFile: filePath,
    env,
    machineUser,
    workspaceId,
  });

  const result = await executeScript({
    client,
    workspaceId,
    name: scriptName,
    code: bundledCode,
    arg: resolvedArg === undefined ? undefined : JSON.parse(resolvedArg),
    invoker: authInvoker,
  });

  return { ...result, scriptName, functionType: detected.type, functionName: detected.name };
}

describe.sequential("E2E: function test-run", () => {
  beforeAll(async () => {
    // Create workspace (supports both TAILOR_PLATFORM_TOKEN env var and platform config login)
    const accessToken = await loadAccessToken();
    client = await initOperatorClient(accessToken);
    const region = await resolveE2EWorkspaceRegion(client);

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

    // Deploy example config to create DB schema, auth, machine users
    console.log("Deploying example config...");
    execFileSync(
      "node",
      [cliPath, "deploy", "--config", "tailor.config.ts", "--workspace-id", workspaceId, "--yes"],
      {
        cwd: exampleDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_OPTIONS: "--experimental-vm-modules" },
        encoding: "utf-8",
        timeout: 120000,
      },
    );
    console.log("Deploy completed.");

    // Resolve machine user from API + config
    let machineUserId = "00000000-0000-0000-0000-000000000000";
    try {
      const resp = await client.getAuthMachineUser({
        workspaceId,
        authNamespace: AUTH_NAMESPACE,
        name: MACHINE_USER_NAME,
      });
      if (resp.machineUser?.id) {
        machineUserId = resp.machineUser.id;
      }
    } catch {
      // fallback to nil UUID
    }
    machineUser = {
      name: MACHINE_USER_NAME,
      id: machineUserId,
      attributes: { role: "MANAGER" },
      attributeList: [],
    };

    authInvoker = create(AuthInvokerSchema, {
      namespace: AUTH_NAMESPACE,
      machineUserName: MACHINE_USER_NAME,
    });
  }, 120000);

  describe("resolver", () => {
    test("runs add resolver with input arguments", async () => {
      const result = await runTestRun("resolvers/add.ts", {
        arg: '{"a":1,"b":2}',
      });

      expect(result.success).toBe(true);
      expect(result.functionType).toBe("resolver");
      expect(result.functionName).toBe("add");
      expect(result.scriptName).toContain("add");
      expect(JSON.parse(result.result)).toBe(3);
    });

    test("returns machine user context from userInfo resolver", async () => {
      const result = await runTestRun("resolvers/userInfo.ts");

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      const nilUuid = "00000000-0000-0000-0000-000000000000";

      expect(parsed.user.type).toBe("machine_user");
      expect(parsed.user.workspaceId).toBe(workspaceId);
      expect(parsed.user.role).toBe("MANAGER");
      expect(parsed.user.id).toMatch(uuidRegex);
      expect(parsed.user.id).not.toBe(nilUuid);

      expect(parsed.invoker.type).toBe("machine_user");
      expect(parsed.invoker.workspaceId).toBe(workspaceId);
      expect(parsed.invoker.role).toBe("MANAGER");
      expect(parsed.invoker.id).toMatch(uuidRegex);
      expect(parsed.invoker.id).not.toBe(nilUuid);
    });

    test("injects environment variables into resolver", async () => {
      const result = await runTestRun("resolvers/env.ts", {
        arg: '{"multiplier":3}',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.result).toBe(3); // 3 * env.foo (env.foo = 1)
      expect(parsed.envBar).toBe("hello");
      expect(parsed.envBaz).toBe(true);
      expect(result.logs).toContain("Environment variables:");
    });

    test("supports getDB in resolver (stepChain)", async () => {
      const result = await runTestRun("resolvers/stepChain.ts", {
        arg: '{"user":{"name":{"first":"John","last":"Doe"}}}',
      });

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.result.summary).toHaveLength(3);
      expect(parsed.result.summary[0]).toContain("Hello John Doe");
      expect(parsed.result.summary[1]).toMatch(/step2: recorded \d{4}-\d{2}-\d{2}/);
      expect(typeof parsed.result.summary[2]).toBe("string");
    });

    test("inserts nested object with Date and verifies round-trip", async () => {
      const result = await runTestRun("resolvers/insertNestedProfileWithDate.ts", {
        arg: '{"name":"Test User","email":"test@example.com"}',
      });

      expect(result.success).toBe(true);
      // Log should contain typeof info from the resolver
      expect(result.logs).toContain("typeof metadata.created:");
      const parsed = JSON.parse(result.result);
      expect(parsed.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      // Verify nested datetime was stored and returned as a valid date
      expect(parsed.metadataCreated).toBeTruthy();
      expect(new Date(parsed.metadataCreated).getFullYear()).toBeGreaterThanOrEqual(2026);
    });

    test("reports validation errors for invalid input", async () => {
      const result = await runTestRun("resolvers/add.ts", {
        arg: '{"a":100,"b":2}',
      });

      expect(result.success).toBe(false);
    });
  });

  describe("executor", () => {
    test("runs webhook executor with body args", async () => {
      const result = await runTestRun("executors/testWebhook.ts", {
        arg: '{"body":{"message":"hello"},"headers":{}}',
      });

      expect(result.success).toBe(true);
      expect(result.functionType).toBe("executor");
      expect(result.functionName).toBe("test-webhook");
      expect(result.logs).toContain("Webhook received");
    });
  });

  describe("workflow job", () => {
    test("runs workflow job by name (check-inventory)", async () => {
      const result = await runTestRun("workflows/sample.ts", {
        name: "check-inventory",
      });

      expect(result.success).toBe(true);
      expect(result.functionType).toBe("workflow-job");
      expect(result.functionName).toBe("check-inventory");
      const parsed = JSON.parse(result.result);
      expect(parsed).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("pre-bundled .js file", () => {
    test("runs pre-bundled .js file directly", async () => {
      // Bundle the resolver first to create the .js file
      const sourceFile = path.resolve(exampleDir, "resolvers/add.ts");
      const detected = await detectFunctionType({ filePath: sourceFile });
      const { bundledCode } = await bundleForTestRun({
        detected,
        sourceFile,
        env,
        machineUser,
        workspaceId,
      });

      // Write bundled code to a temp .js file
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pre-bundled-"));
      const jsFile = path.join(tempDir, "add.js");
      fs.writeFileSync(jsFile, bundledCode);

      // Execute the pre-bundled .js file directly (bypasses detect/bundle)
      const code = fs.readFileSync(jsFile, "utf-8");
      const result = await executeScript({
        client,
        workspaceId,
        name: "add.js",
        code,
        arg: { a: 5, b: 7 },
        invoker: authInvoker,
      });

      expect(result.success).toBe(true);
      expect(JSON.parse(result.result)).toBe(12);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true });
    });
  });

  describe("error handling", () => {
    test("separates logs from error in failure output", async () => {
      const fixtureDir = path.join(__dirname, "fixtures", "function-test-run");
      const filePath = path.join(fixtureDir, "error-function.ts");

      const detected = await detectFunctionType({ filePath });
      const { bundledCode, scriptName } = await bundleForTestRun({
        detected,
        sourceFile: filePath,
        env: {},
        machineUser,
        workspaceId,
      });
      const result = await executeScript({
        client,
        workspaceId,
        name: scriptName,
        code: bundledCode,
        invoker: authInvoker,
      });

      expect(result.success).toBe(false);
      expect(result.logs).toContain("Log line 1");
      expect(result.logs).toContain("Log line 2");
      expect(result.error).toBeDefined();
      expect(result.error).not.toContain("Log line 1");
    });
  });
});
