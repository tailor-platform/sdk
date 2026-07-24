import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import {
  checkMigrationDiffs,
  toTailorDBDeployInput,
  verifyRemoteSchema,
} from "#/cli/commands/deploy/tailordb/validation";
import { deploymentArgs } from "#/cli/shared/args";
import { logBetaWarning } from "#/cli/shared/beta";
import { initOperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadConfig } from "#/cli/shared/config-loader";
import { loadAccessToken, loadWorkspaceId } from "#/cli/shared/context";
import { logger, styles } from "#/cli/shared/logger";
import { PluginManager } from "#/plugin/manager";
import { getNamespacesWithMigrations, type NamespaceWithMigrations } from "./config";
import { formatDiffSummary, formatMigrationDiff, type MigrationDiff } from "./diff-calculator";
import { assertValidMigrationFiles, formatMigrationNumber, formatSchemaDrifts } from "./snapshot";
import type { SchemaDrift } from "./types";

export interface ValidateOptions {
  configPath?: string;
  namespace?: string;
  workspaceId?: string;
  profile?: string;
  json?: boolean;
}

interface MigrationFilesReport {
  valid: boolean;
  error?: string;
}

interface LocalSchemaReport {
  hasDiff: boolean;
  /** Present when local types drifted from the latest migration snapshot; absent when the drift is a missing snapshot */
  diff?: MigrationDiff;
}

interface RemoteSchemaReport {
  remoteMigrationNumber: number;
  hasDrift: boolean;
  drifts: SchemaDrift[];
}

interface NamespaceValidationReport {
  namespace: string;
  valid: boolean;
  migrationFiles: MigrationFilesReport;
  /** Omitted when the migration files are invalid (the check cannot run) */
  localSchema?: LocalSchemaReport;
  /** Omitted when the migration files are invalid (the check cannot run) */
  remoteSchema?: RemoteSchemaReport;
}

/**
 * Run all migration validation checks and collect per-namespace reports
 * @param {ValidateOptions} options - Command options
 * @returns {Promise<NamespaceValidationReport[]>} Validation reports per namespace
 */
async function collectValidationReports(
  options: ValidateOptions,
): Promise<NamespaceValidationReport[]> {
  const { config, plugins } = await loadConfig(options.configPath);
  const configDir = path.dirname(config.path);

  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);
  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }

  const targetNamespaces = options.namespace
    ? namespacesWithMigrations.filter((ns) => ns.namespace === options.namespace)
    : namespacesWithMigrations;
  if (targetNamespaces.length === 0) {
    throw new Error(
      `Namespace "${options.namespace}" not found or does not have migrations configured`,
    );
  }

  const pluginManager = plugins.length > 0 ? new PluginManager(plugins) : undefined;
  const { defineApplication } = await import("#/cli/services/application");
  const application = defineApplication({ config, pluginManager });
  for (const service of application.tailorDBServices) {
    await service.loadTypes();
    await service.processNamespacePlugins();
  }
  for (const { namespace } of targetNamespaces) {
    if (!application.tailorDBServices.some((s) => s.namespace === namespace)) {
      throw new Error(`No TailorDB service found for namespace "${namespace}"`);
    }
  }
  const tailorDBInputs = application.tailorDBServices.map(toTailorDBDeployInput);
  const typesByNamespace = new Map(tailorDBInputs.map((input) => [input.namespace, input.types]));

  const accessToken = await loadAccessToken({
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = await loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  const migrationFileErrors = new Map<string, string>();
  const checkableNamespaces: NamespaceWithMigrations[] = [];
  for (const target of targetNamespaces) {
    try {
      assertValidMigrationFiles(target.migrationsDir, target.namespace);
      checkableNamespaces.push(target);
    } catch (error) {
      migrationFileErrors.set(
        target.namespace,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const localResults = await checkMigrationDiffs(typesByNamespace, checkableNamespaces);
  const remoteResults = await verifyRemoteSchema(
    client,
    workspaceId,
    checkableNamespaces,
    config,
    tailorDBInputs,
  );

  return targetNamespaces.map((target) => {
    const fileError = migrationFileErrors.get(target.namespace);
    if (fileError !== undefined) {
      return {
        namespace: target.namespace,
        valid: false,
        migrationFiles: { valid: false, error: fileError },
      };
    }

    const local = localResults.find((r) => r.namespace === target.namespace);
    const remote = remoteResults.find((r) => r.namespace === target.namespace);
    const localSchema: LocalSchemaReport = {
      hasDiff: local?.hasDiff ?? false,
      ...(local?.diff ? { diff: local.diff } : {}),
    };
    const remoteSchema: RemoteSchemaReport = {
      remoteMigrationNumber: remote?.remoteMigrationNumber ?? 0,
      hasDrift: remote?.hasDrift ?? false,
      drifts: remote?.drifts ?? [],
    };

    return {
      namespace: target.namespace,
      valid: !localSchema.hasDiff && !remoteSchema.hasDrift,
      migrationFiles: { valid: true },
      localSchema,
      remoteSchema,
    };
  });
}

function printValidationReports(reports: NamespaceValidationReport[]): void {
  for (const report of reports) {
    logger.newline();
    logger.info(`Namespace: ${styles.bold(report.namespace)}`);

    if (!report.migrationFiles.valid) {
      logger.log(`  Migration files: ${styles.error("invalid")}`);
      logger.log(`    ${report.migrationFiles.error}`);
      continue;
    }
    logger.log(`  Migration files: ${styles.success("OK")}`);

    const local = report.localSchema;
    if (local?.hasDiff) {
      if (local.diff) {
        logger.log(`  Local schema: ${styles.error("changes not in migration files")}`);
        logger.log(`    ${formatDiffSummary(local.diff)}`);
        logger.log(formatMigrationDiff(local.diff));
      } else {
        logger.log(`  Local schema: ${styles.error("no migration snapshot found")}`);
      }
    } else {
      logger.log(`  Local schema: ${styles.success("OK")}`);
    }

    const remote = report.remoteSchema;
    if (remote?.hasDrift) {
      logger.log(
        `  Remote schema: ${styles.error("drift detected")} (remote migration: ${formatMigrationNumber(remote.remoteMigrationNumber)})`,
      );
      logger.log(formatSchemaDrifts(remote.drifts));
    } else if (remote) {
      logger.log(
        `  Remote schema: ${styles.success("OK")} (remote migration: ${formatMigrationNumber(remote.remoteMigrationNumber)})`,
      );
    }
  }
  logger.newline();
}

function printResolutionHints(reports: NamespaceValidationReport[]): void {
  if (reports.some((r) => r.localSchema?.hasDiff && !r.localSchema.diff)) {
    logger.info("Run 'tailor-sdk tailordb migration generate' to create the initial snapshot.");
  }
  if (reports.some((r) => r.localSchema?.diff)) {
    logger.info("Run 'tailor-sdk tailordb migration generate' to create migration files.");
  }
  if (reports.some((r) => r.remoteSchema?.hasDrift)) {
    logger.info("Remote schema drift may indicate:");
    logger.info("  - Another developer applied different migrations", { mode: "plain" });
    logger.info("  - Manual schema changes were made directly", { mode: "plain" });
    logger.info("  - Migration history is out of sync", { mode: "plain" });
    logger.info("To resolve:");
    logger.info("  - Run 'tailor-sdk tailordb migration status' to compare local vs remote.", {
      mode: "plain",
    });
    logger.info("  - If remote is correct, update local types and run 'migration generate'.", {
      mode: "plain",
    });
    logger.info(
      "  - If local migration history is correct, run 'migration sync <N>' to overwrite remote.",
      { mode: "plain" },
    );
    logger.info("  - If only bookkeeping is stale, run 'migration set <N>'.", { mode: "plain" });
  }
}

/**
 * Validate migration files and schema state without deploying
 * @param {ValidateOptions} options - Command options
 */
async function validate(options: ValidateOptions): Promise<void> {
  logBetaWarning("tailordb migration");

  const reports = await collectValidationReports(options);
  const invalidCount = reports.filter((r) => !r.valid).length;

  if (options.json) {
    logger.out(reports);
  } else {
    printValidationReports(reports);
    if (invalidCount === 0) {
      logger.success("All migration validation checks passed.");
    } else {
      printResolutionHints(reports);
    }
  }

  if (invalidCount > 0) {
    throw new Error(`Migration validation failed for ${invalidCount} namespace(s)`);
  }
}

export const validateCommand = defineAppCommand({
  name: "validate",
  description:
    "Validate migration files and detect schema drift (local types vs. migration snapshot, remote schema vs. migration checkpoint) without deploying. Runs the same checks as 'deploy' and exits with a non-zero code when issues are found.",
  args: z
    .object({
      ...deploymentArgs,
      namespace: arg(z.string().optional(), {
        alias: "n",
        description: "Target TailorDB namespace (validates all namespaces if not specified)",
      }),
    })
    .strict(),
  run: async (args) => {
    await validate({
      configPath: args.config,
      namespace: args.namespace,
      workspaceId: args["workspace-id"],
      profile: args.profile,
      json: logger.jsonMode,
    });
  },
});
