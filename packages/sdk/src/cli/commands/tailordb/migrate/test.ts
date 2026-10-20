import { arg } from "@politty/zod";
import { z } from "zod";
import { ageArg } from "#/cli/commands/workspace/age";
import {
  deploymentArgs,
  durationArg,
  locationIdsWithEnvFile,
  parseDuration,
} from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError, formatCommandHint } from "#/cli/shared/errors";
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
    throw CLIError({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: "--target-workspace-id requires --yes because the target may be overwritten.",
      command: "tailordb migration test",
    });
  }
  if (options.keep && options.targetWorkspaceId) {
    throw CLIError({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message:
        "--keep applies only to automatically created workspaces; a designated target is always retained.",
      command: "tailordb migration test",
    });
  }
  if (options.keepTtl !== undefined && !options.keep) {
    throw CLIError({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: "--keep-ttl was given without --keep.",
      suggestion: "Pass --keep together with --keep-ttl, or remove --keep-ttl.",
      command: "tailordb migration test",
    });
  }
  if (options.cloneTimeout !== undefined && options.data !== "clone") {
    throw CLIError({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: "--clone-timeout was given without --data clone.",
      suggestion: "Pass --data clone, or remove --clone-timeout.",
      command: "tailordb migration test",
    });
  }
  if (options.assertionNamespace && !options.assertionPath) {
    throw CLIError({
      code: "MIGRATION_TEST_OPTIONS_INVALID",
      message: "--assert is required when --assert-namespace is provided.",
      command: "tailordb migration test",
    });
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
        createdAt: undefined,
      };
  let expiryRecorded = false;
  if (temporary && options.keepTtl !== undefined) {
    try {
      await dependencies.recordWorkspaceExpiry(workspace.id, options.keepTtl, workspace.createdAt);
      expiryRecorded = true;
    } catch (expiryError) {
      logger.warn(
        `Failed to record an expiry on temporary workspace ${workspace.id}: ${expiryError instanceof Error ? expiryError.message : String(expiryError)}. Record one with ${formatCommandHint(
          {
            command: "tailor",
            args: [
              "workspace",
              "ttl",
              "set",
              "--ttl",
              options.keepTtl,
              `--workspace-id=${workspace.id}`,
              ...(options.profile ? [`--profile=${options.profile}`] : []),
            ],
          },
        )}.`,
      );
    }
  }
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
      cloneTimeout: options.cloneTimeout,
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

  if (temporary && options.keep) {
    logger.info(
      `Keeping temporary workspace ${workspace.name ?? workspace.id}${expiryRecorded ? `; it can be pruned after ${options.keepTtl}` : ""}.`,
    );
  } else if (temporary) {
    try {
      await dependencies.deleteWorkspace(workspace.id);
      deleted = true;
    } catch (cleanupError) {
      if (!failed) {
        throw CLIError({
          code: "MIGRATION_TEST_WORKSPACE_CLEANUP_FAILED",
          message: `Failed to delete temporary workspace ${workspace.id}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          suggestion: options.profile
            ? `Delete the temporary workspace manually with TAILOR_PLATFORM_PROFILE=${options.profile}.`
            : "Delete the temporary workspace manually.",
          next: {
            command: "tailor",
            args: ["workspace", "delete", "--workspace-id", workspace.id],
          },
          cause: cleanupError,
        });
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
    "The source workspace is read-only. Without --target-workspace-id, the command creates a workspace in the source workspace's region and deletes it after success or failure; pass --keep to retain it for inspection. A designated target is retained and requires --yes. Clone mode copies TailorDB records only; it does not copy IdP users or file blobs. With --keep-ttl, the kept workspace records an expiry; it is not deleted automatically, but workspace prune --expired removes it once the expiry has passed.",
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
    keep: arg(z.boolean().default(false), {
      description: "Keep the automatically created workspace after the test",
    }),
    "organization-id": arg(z.uuid().optional(), {
      description:
        "Organization to create the temporary workspace in, at its root unless --folder-id is given (default: the source workspace's organization and folder). With --target-workspace-id, must match the target's organization",
      env: "TAILOR_PLATFORM_ORGANIZATION_ID",
    }),
    "folder-id": arg(z.uuid().optional(), {
      description:
        "Folder to create the temporary workspace in (default: the source workspace's folder). Requires --organization-id when the source workspace is not in an organization. With --target-workspace-id, must match the target's folder",
      env: "TAILOR_PLATFORM_FOLDER_ID",
    }),
    assert: arg(z.string().optional(), {
      description: "Path to a TypeScript assertion script to run after migrations",
      completion: { type: "file", extensions: ["ts"] },
    }),
    "assert-namespace": arg(z.string().optional(), {
      description: "TailorDB namespace exposed to the assertion script",
    }),
    "keep-ttl": arg(ageArg.optional(), {
      description:
        "Record an expiry on the kept workspace, e.g. 24h or 7d, so workspace prune --expired can delete it (requires --keep)",
      completion: { type: "none" },
    }),
    "clone-timeout": arg(durationArg.optional(), {
      description:
        "How long to wait for the clone to finish with --data clone, e.g. 30s or 10m (default: 30m)",
      completion: { type: "none" },
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
      keep: args.keep,
      keepTtl: args["keep-ttl"],
      ...locationIdsWithEnvFile(args),
      assertionPath: args.assert,
      assertionNamespace: args["assert-namespace"],
      machineUser: args["machine-user"],
      cloneTimeout:
        args["clone-timeout"] === undefined ? undefined : parseDuration(args["clone-timeout"]),
      yes: args.yes,
      json: logger.jsonMode,
    });
  },
});
