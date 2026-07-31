/**
 * E2E tests for `tailor seed apply` (this package's `tailor seed` CLI plugin).
 *
 * Prerequisites:
 * - Authentication via TAILOR_PLATFORM_TOKEN env var or `tailor login`
 * - TAILOR_PLATFORM_ORGANIZATION_ID environment variable must be set
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deploy,
  generate,
  initOperatorClient,
  loadAccessToken,
  type OperatorClient,
} from "@tailor-platform/sdk/cli";
import { runCommand } from "politty";
import { aroundAll, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { seedApplyCommand } from "../src/apply";
import { commonArgs } from "../src/shared/args";
import {
  resolveE2ERunId,
  resolveE2EWorkspaceRegion,
  trackTempDir,
  trackWorkspace,
} from "./globalSetup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NO_COLOR = "1";

const ciRunId = resolveE2ERunId();
const testRunId = Date.now().toString(36);
const testAppName = `e2e-seed-${testRunId}`;
const testWorkspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${testRunId}`;
const dbNamespace = `seed-db-${testRunId}`;
const idpName = `seed-idp-${testRunId}`;
const authName = `seed-auth-${testRunId}`;
const machineUserName = "seed-machine-user";

/**
 * Capture stdout/stderr writes made during a callback, while still letting
 * them through (so the run stays visible in CI logs). The seed plugin's
 * logger writes to these streams directly, bypassing console.* (and thus
 * politty's own `captureLogs` interception).
 * @param fn - Callback to run while capturing output
 * @returns The captured stdout and stderr text
 */
async function captureOutput(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => {
      stdout.push(String(chunk));
      // oxlint-disable-next-line no-explicit-any
      return (originalStdoutWrite as any)(chunk, ...rest);
    });
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => {
      stderr.push(String(chunk));
      // oxlint-disable-next-line no-explicit-any
      return (originalStderrWrite as any)(chunk, ...rest);
    });
  try {
    await fn();
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return { stdout: stdout.join(""), stderr: stderr.join("") };
}

/**
 * Parse the last JSON line written to stdout by `--json`.
 * @param stdout - Captured stdout text
 * @returns The parsed JSON payload
 */
function parseJsonOutput(stdout: string): { success: boolean; processed: Record<string, number> } {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    throw new Error(`Expected a JSON line on stdout, got: ${JSON.stringify(stdout)}`);
  }
  return JSON.parse(lastLine) as { success: boolean; processed: Record<string, number> };
}

describe("E2E: tailor seed apply", () => {
  let workspaceId: string;
  let client: OperatorClient;
  let tempDir: string;
  let configPath: string;
  let dataDir: string;

  aroundAll(async (runSuite) => {
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
    workspaceId = createResp.workspace?.id ?? "";
    if (!workspaceId) throw new Error("createWorkspace did not return a workspace id");
    trackWorkspace(workspaceId);
    console.log(`Workspace created: ${workspaceId}`);
    process.env.TAILOR_PLATFORM_WORKSPACE_ID = workspaceId;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-apply-e2e-"));
    trackTempDir(tempDir);

    // Symlink @tailor-platform/sdk into the temp project so the generated
    // config/tailordb files (which import it) can resolve it.
    const sdkRoot = path.resolve(__dirname, "../../sdk");
    const nodeModulesDir = path.join(tempDir, "node_modules", "@tailor-platform");
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.symlinkSync(sdkRoot, path.join(nodeModulesDir, "sdk"));

    const tailordbDir = path.join(tempDir, "tailordb");
    fs.mkdirSync(tailordbDir, { recursive: true });
    fs.writeFileSync(
      path.join(tailordbDir, "customer.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const customer = db
  .table("Customer", {
    name: db.string(),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);

export type customer = typeof customer;
`,
    );
    fs.writeFileSync(
      path.join(tailordbDir, "user.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    email: db.string(),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission);

export type user = typeof user;
`,
    );

    const tailordbFilesPattern = path.join(tempDir, "tailordb", "*.ts").replace(/\\/g, "/");
    configPath = path.join(tempDir, "tailor.config.ts");
    fs.writeFileSync(
      configPath,
      `
import {
  defineAuth,
  defineConfig,
  defineIdp,
  definePlugins,
  unsafeAllowAllIdPPermission,
} from "@tailor-platform/sdk";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";
import { user } from "./tailordb/user";

const idp = defineIdp("${idpName}", {
  clients: ["default-idp-client"],
  permission: unsafeAllowAllIdPPermission,
});

const auth = defineAuth("${authName}", {
  userProfile: { type: user, usernameField: "email" },
  machineUsers: { "${machineUserName}": {} },
  idProvider: idp.provider("default", "default-idp-client"),
});

export default defineConfig({
  // CI never auto-injects an id (each run would otherwise be treated as a
  // separate app); this suite deploys a fresh, disposable app per run, so
  // it supplies one itself.
  id: "${crypto.randomUUID()}",
  name: "${testAppName}",
  db: { "${dbNamespace}": { files: ["${tailordbFilesPattern}"] } },
  idp: [idp],
  auth,
});

// _User rows in this suite never carry a matching User row (only Customer/User
// schema is exercised here, not the userProfile FK), so skip that FK.
export const plugins = definePlugins(
  seedPlugin({
    distPath: "${path.join(tempDir, "seed").replace(/\\/g, "/")}",
    machineUserName: "${machineUserName}",
    disableIdpUserSync: { idpToUser: true },
  }),
);
`,
    );

    console.log("Deploying test application...");
    await deploy({ workspaceId, configPath, yes: true });

    console.log("Generating seed data files...");
    await generate({ configPath });

    dataDir = path.join(tempDir, "seed", "data");

    await runSuite();
  }, 180000);

  /**
   * Overwrite `<dataDir>/<typeName>.jsonl` with the given rows.
   * @param typeName - TailorDB (or `_User`) type name
   * @param rows - Rows to write, one JSON object per line
   */
  function writeJsonl(typeName: string, rows: Record<string, unknown>[]): void {
    const content = rows.map((row) => JSON.stringify(row)).join("\n");
    fs.writeFileSync(path.join(dataDir, `${typeName}.jsonl`), content ? `${content}\n` : "");
  }

  /**
   * Run `seedApplyCommand` programmatically, the way `tailor seed apply` would.
   * @param args - CLI arguments (excluding the command name)
   * @returns The command's run result
   */
  function runApply(args: string[]) {
    return runCommand(seedApplyCommand, ["--config", configPath, ...args], {
      // Strip unknown global arguments like the plugin entrypoint.
      globalArgs: z.object(commonArgs),
    });
  }

  // Customer.id is a platform-generated UUID column; seed rows must supply
  // real UUIDs to pass through to a real deployed workspace.
  const customer1Id = crypto.randomUUID();
  const customer2Id = crypto.randomUUID();
  const customer3Id = crypto.randomUUID();

  test("seeds new TailorDB rows without --upsert", async () => {
    writeJsonl("Customer", [
      { id: customer1Id, name: "Alice" },
      { id: customer2Id, name: "Bob" },
    ]);

    const { stdout } = await captureOutput(async () => {
      const result = await runApply(["--machine-user", machineUserName, "--json"]);
      expect(result.exitCode).toBe(0);
    });

    const output = parseJsonOutput(stdout);
    expect(output.success).toBe(true);
    expect(output.processed.Customer).toBe(2);
  }, 120000);

  test("--upsert inserts new rows and updates existing rows", async () => {
    writeJsonl("Customer", [
      { id: customer1Id, name: "Alice Updated" },
      { id: customer3Id, name: "Carol" },
    ]);

    const { stdout, stderr } = await captureOutput(async () => {
      const result = await runApply(["--machine-user", machineUserName, "--upsert", "--json"]);
      expect(result.exitCode).toBe(0);
    });

    const output = parseJsonOutput(stdout);
    expect(output.success).toBe(true);
    // 1 insert (customer3Id) + 1 update (customer1Id), proving the probe
    // found the row a prior, non-upsert apply actually persisted.
    expect(output.processed.Customer).toBe(2);
    expect(stderr).toContain("Customer: 1 inserted, 1 updated");
  }, 120000);

  test("--upsert creates, updates, and skips _User rows", async () => {
    writeJsonl("_User", [{ name: "ada@example.com", password: "Sup3rSecret1!" }]);

    const { stderr: firstStderr } = await captureOutput(async () => {
      const result = await runApply(["--machine-user", machineUserName, "--upsert", "_User"]);
      expect(result.exitCode).toBe(0);
    });
    expect(firstStderr).toContain("_User: 1 created, 0 updated");

    // ada now has no attributes beyond `name` (a seed row that only sets the
    // password on creation) -> the update branch must skip it rather than
    // issue a no-op update; bob is new -> still created under the same run.
    writeJsonl("_User", [
      { name: "ada@example.com" },
      { name: "bob@example.com", password: "Sup3rSecret2!" },
    ]);

    const { stdout, stderr } = await captureOutput(async () => {
      const result = await runApply([
        "--machine-user",
        machineUserName,
        "--upsert",
        "--json",
        "_User",
      ]);
      expect(result.exitCode).toBe(0);
    });

    const output = parseJsonOutput(stdout);
    expect(output.success).toBe(true);
    expect(stderr).toContain("_User: 1 created, 0 updated, 1 skipped");
  }, 120000);

  test("--truncate empties tables before seeding", async () => {
    // Re-seeding the same ids as a prior test would fail on duplicate ids
    // without --upsert unless --truncate actually cleared the table first.
    writeJsonl("Customer", [
      { id: customer1Id, name: "Alice Fresh" },
      { id: customer3Id, name: "Carol Fresh" },
    ]);
    writeJsonl("_User", [{ name: "ada@example.com", password: "Sup3rSecret1!" }]);

    const { stdout } = await captureOutput(async () => {
      const result = await runApply([
        "--machine-user",
        machineUserName,
        "--truncate",
        "--yes",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
    });

    const output = parseJsonOutput(stdout);
    expect(output.success).toBe(true);
    expect(output.processed.Customer).toBe(2);
    expect(output.processed._User).toBe(1);
  }, 120000);
});
