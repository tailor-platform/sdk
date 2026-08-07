import { arg } from "politty";
import { z } from "zod";
import { deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { assertDefined } from "#/utils/assert";
import {
  assertCloneTargetRegion,
  assertTargetWorkspaceDiffers,
  createMigrationTestDependencies,
  resolveAssertionNamespace,
} from "./test-runtime";
import type {
  MigrationTestDependencies,
  MigrationTestOptions,
  MigrationTestResult,
} from "./test-types";
export type {
  MigrationTestDependencies,
  MigrationTestOptions,
  MigrationTestResult,
  PreparedMigrationTest,
} from "./test-types";

/**
 * Run pending migrations against an isolated target workspace.
 * @param options - Migration test options
 * @param dependencies - Runtime operations used by the migration test
 * @returns Migration test result
 */
export async function runMigrationTest(
  options: MigrationTestOptions,
  dependencies: MigrationTestDependencies = createMigrationTestDependencies(),
): Promise<MigrationTestResult> {
  if (options.targetWorkspaceId && !options.yes) {
    throw new Error("--target-workspace-id requires --yes because the target may be overwritten.");
  }
  if (options.assertionNamespace && !options.assertionPath) {
    throw new Error("--assert is required when --assert-namespace is provided.");
  }

  const prepared = await dependencies.prepare(options);
  assertTargetWorkspaceDiffers(prepared.sourceWorkspaceId, options.targetWorkspaceId);
  if (options.assertionPath) {
    resolveAssertionNamespace(prepared.pendingNamespaces, options.assertionNamespace);
  }
  if (options.data === "clone" && options.targetWorkspaceId) {
    const target = assertDefined(
      prepared.designatedTarget,
      "designated clone target was not loaded during preparation",
    );
    assertCloneTargetRegion(prepared.temporaryWorkspace.region, target.region);
  }
  const temporary = options.targetWorkspaceId === undefined;
  const workspace = temporary
    ? await dependencies.createWorkspace(prepared)
    : {
        id: assertDefined(options.targetWorkspaceId, "designated target workspace missing"),
        name: undefined,
      };
  let primaryError: unknown;
  let failed = false;
  let deleted = false;

  try {
    const target = { prepared, targetWorkspaceId: workspace.id };
    await dependencies.deployBaseline(target);

    const dataTarget = {
      ...target,
      sourceWorkspaceId: prepared.sourceWorkspaceId,
      applicationName: prepared.sourceApplicationName,
    };
    if (options.data === "clone") {
      await dependencies.cloneData(dataTarget);
    } else {
      await dependencies.seedData(dataTarget);
    }

    await dependencies.deployMigrations(target);
    if (options.assertionPath) {
      await dependencies.runAssertion({
        ...target,
        assertionPath: options.assertionPath,
        assertionNamespace: options.assertionNamespace,
        machineUser: options.machineUser,
      });
    }
  } catch (error) {
    primaryError = error;
    failed = true;
  }

  if (temporary) {
    try {
      await dependencies.deleteWorkspace(workspace.id);
      deleted = true;
    } catch (cleanupError) {
      if (!failed) {
        throw new Error(
          `Failed to delete temporary workspace ${workspace.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          { cause: cleanupError },
        );
      }
      logger.warn(
        `Failed to delete temporary workspace ${workspace.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    }
  }
  if (failed) {
    throw primaryError;
  }

  return {
    success: true,
    workspaceId: workspace.id,
    ...(workspace.name ? { workspaceName: workspace.name } : {}),
    temporary,
    deleted,
    data: options.data,
    pendingNamespaces: prepared.pendingNamespaces,
  };
}

async function migrationTest(options: MigrationTestOptions): Promise<void> {
  logBetaWarning("tailordb migration");
  const result = await runMigrationTest(options);
  if (options.json) {
    logger.out(result);
    return;
  }
  logger.success(
    `Pending migrations completed in workspace ${result.workspaceName ?? result.workspaceId}.`,
  );
}

export const testCommand = defineAppCommand({
  name: "test",
  description:
    "Test pending migrations with seed fixtures or cloned data in a temporary workspace.",
  notes:
    "The source workspace is read-only. Without --target-workspace-id, the command creates a workspace in the source workspace's region and deletes it after success or failure. A designated target is retained and requires --yes. Clone mode copies TailorDB records only; it does not copy IdP users or file blobs.",
  args: z.strictObject({
    ...deploymentArgs,
    yes: arg(z.boolean().default(false), {
      alias: "y",
      description: "Acknowledge that a designated target workspace may be overwritten",
    }),
    data: arg(z.enum(["seed", "clone"]).default("seed"), {
      description: "Data source for the migration test (seed or clone)",
    }),
    "target-workspace-id": arg(z.uuid().optional(), {
      description: "Existing throwaway workspace to retain after the test (requires --yes)",
    }),
    assert: arg(z.string().optional(), {
      description: "Path to a TypeScript assertion script to run after migrations",
      completion: { type: "file", extensions: ["ts"] },
    }),
    "assert-namespace": arg(z.string().optional(), {
      description: "TailorDB namespace exposed to the assertion script",
    }),
    "machine-user": arg(z.string().optional(), {
      description: "Machine user for seed and assertion script execution",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    await migrationTest({
      configPath: args.config,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      data: args.data,
      targetWorkspaceId: args["target-workspace-id"],
      assertionPath: args.assert,
      assertionNamespace: args["assert-namespace"],
      machineUser: args["machine-user"],
      yes: args.yes,
      json: logger.jsonMode,
    });
  },
});
