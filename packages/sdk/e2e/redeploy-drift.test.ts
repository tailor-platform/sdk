/**
 * E2E check that redeploying an unchanged config plans no changes, for the resources that the
 * Workspace Deploy Test's example/ does not configure: a tenant provider and an Auth connection.
 * src/cli/commands/deploy/drift-check-coverage.test.ts lists which config covers each resource type.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { aroundAll, describe, expect, test } from "vitest";
import { initOperatorClient } from "../src/cli/shared/client";
import { loadAccessToken } from "../src/cli/shared/context";
import { CLI_BUDGET_MS, cliTestTimeout, runCli } from "./cli";
import {
  WORKSPACE_CREATION_ALLOWANCE_MS,
  resolveE2ERunId,
  resolveE2EWorkspaceLocation,
  resolveE2EWorkspaceRegion,
  trackTempDir,
  trackWorkspace,
} from "./globalSetup";

const sdkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(sdkRoot, "e2e", "fixtures", "redeploy");

describe("E2E: redeploying an unchanged config", { concurrent: false }, () => {
  let workspaceId: string;
  let projectDir: string;

  aroundAll(async (runSuite) => {
    const client = await initOperatorClient(await loadAccessToken());
    const ciRunId = resolveE2ERunId();
    const workspaceName = `e2e-ws-${ciRunId ? `${ciRunId}-` : ""}${Date.now().toString(36)}-redeploy`;
    const created = await client.createWorkspace({
      workspaceName,
      workspaceRegion: await resolveE2EWorkspaceRegion(client),
      deleteProtection: false,
      ...(await resolveE2EWorkspaceLocation()),
    });
    workspaceId = created.workspace!.id;
    await trackWorkspace(client, workspaceId);

    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "redeploy-e2e-"));
    trackTempDir(projectDir);
    fs.cpSync(fixtureDir, projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ type: "module" }));
    const scopeDir = path.join(projectDir, "node_modules", "@tailor-platform");
    fs.mkdirSync(scopeDir, { recursive: true });
    fs.symlinkSync(sdkRoot, path.join(scopeDir, "sdk"));

    await runSuite();
  }, WORKSPACE_CREATION_ALLOWANCE_MS);

  test(
    "plans no changes for a tenant provider and an Auth connection",
    async ({ signal }) => {
      const deployArgs = ["deploy", "--config", "tailor.config.ts", "--workspace-id", workspaceId];
      await runCli([...deployArgs, "--yes"], {
        cwd: projectDir,
        timeoutMs: CLI_BUDGET_MS.deploy,
        signal,
      });

      const dryRun = await runCli([...deployArgs, "--dry-run", "--yes", "--json"], {
        cwd: projectDir,
        timeoutMs: CLI_BUDGET_MS.deploy,
        signal,
      });

      const plan = JSON.parse(dryRun.stdout.trim().split("\n").at(-1) ?? "") as {
        summary: Record<string, number>;
        changes: unknown[];
      };
      expect(plan.changes).toEqual([]);
      expect(plan.summary).toMatchObject({ create: 0, update: 0, delete: 0, replace: 0 });
    },
    cliTestTimeout(CLI_BUDGET_MS.deploy, CLI_BUDGET_MS.deploy),
  );
});
