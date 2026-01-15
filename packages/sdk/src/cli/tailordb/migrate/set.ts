import * as path from "node:path";
import { defineCommand } from "citty";
import { trnPrefix } from "../../apply/services/label";
import { commonArgs, workspaceArgs, deploymentArgs, withCommonArgs } from "../../args";
import { initOperatorClient } from "../../client";
import { loadConfig } from "../../config-loader";
import { loadAccessToken, loadWorkspaceId } from "../../context";
import { logger, styles } from "../../utils/logger";
import { getNamespacesWithMigrations } from "./types";
import { formatMigrationNumber, isValidMigrationNumber, parseMigrationLabelNumber } from "./types";

export interface SetOptions {
  configPath?: string;
  number: string;
  namespace?: string;
  yes?: boolean;
  workspaceId?: string;
  profile?: string;
}

/**
 * Set migration checkpoint for a TailorDB namespace
 * @param {SetOptions} options - Command options
 */
async function set(options: SetOptions): Promise<void> {
  // 1. Validate migration number format
  const numberStr = options.number;

  // Accept either 4-digit format (0001) or integer (1)
  let migrationNumber: number;
  if (isValidMigrationNumber(numberStr)) {
    // 4-digit format
    migrationNumber = parseInt(numberStr, 10);
  } else {
    // Try parsing as integer
    migrationNumber = parseInt(numberStr, 10);
    if (isNaN(migrationNumber) || migrationNumber < 0) {
      throw new Error(
        `Invalid migration number format: ${numberStr}. Expected 4-digit format (e.g., 0001) or integer (e.g., 1).`,
      );
    }
  }

  // 2. Load configuration
  const { config, configPath } = await loadConfig(options.configPath);
  const configDir = path.dirname(configPath);

  // 3. Get namespaces with migrations
  const namespacesWithMigrations = getNamespacesWithMigrations(config, configDir);

  if (namespacesWithMigrations.length === 0) {
    throw new Error("No TailorDB services with migrations configuration found");
  }

  // 4. Determine target namespace
  let targetNamespace: string;
  if (options.namespace) {
    if (!namespacesWithMigrations.some((ns) => ns.namespace === options.namespace)) {
      throw new Error(
        `Namespace "${options.namespace}" not found or does not have migrations configured`,
      );
    }
    targetNamespace = options.namespace;
  } else if (namespacesWithMigrations.length === 1) {
    targetNamespace = namespacesWithMigrations[0].namespace;
  } else {
    throw new Error(
      `Multiple TailorDB services found. Please specify namespace with --namespace flag: ${namespacesWithMigrations.map((ns) => ns.namespace).join(", ")}`,
    );
  }

  // 5. Initialize client
  const accessToken = await loadAccessToken({
    useProfile: false,
    profile: options.profile,
  });
  const client = await initOperatorClient(accessToken);
  const workspaceId = loadWorkspaceId({
    workspaceId: options.workspaceId,
    profile: options.profile,
  });

  // 6. Get current migration number
  const trn = `${trnPrefix(workspaceId)}:tailordb:${targetNamespace}`;
  let currentMigration: number;
  try {
    const { metadata } = await client.getMetadata({ trn });
    const label = metadata?.labels?.["sdk-migration"];
    currentMigration = label ? (parseMigrationLabelNumber(label) ?? 0) : 0;
  } catch {
    currentMigration = 0;
  }

  // 7. Display warning and confirmation
  logger.newline();
  logger.warn("⚠️  This operation will change the migration checkpoint.");
  logger.log(`Namespace: ${styles.bold(targetNamespace)}`);
  logger.log(`Current migration: ${styles.bold(formatMigrationNumber(currentMigration))}`);
  logger.log(`New migration: ${styles.bold(formatMigrationNumber(migrationNumber))}`);
  logger.newline();

  if (migrationNumber < currentMigration) {
    logger.warn(
      `Setting migration number backwards (${formatMigrationNumber(currentMigration)} → ${formatMigrationNumber(migrationNumber)}) will cause previous migrations to be re-executed on next apply.`,
    );
    logger.newline();
  } else if (migrationNumber > currentMigration) {
    logger.warn(
      `Setting migration number forwards (${formatMigrationNumber(currentMigration)} → ${formatMigrationNumber(migrationNumber)}) will skip migrations ${formatMigrationNumber(currentMigration + 1)} to ${formatMigrationNumber(migrationNumber)}.`,
    );
    logger.newline();
  }

  // 8. Confirmation prompt (unless --yes flag)
  if (!options.yes) {
    const confirmation = await logger.prompt("Continue with migration checkpoint update?", {
      type: "confirm",
      initial: false,
    });

    if (!confirmation) {
      logger.info("Operation cancelled.");
      return;
    }
    logger.newline();
  }

  // 9. Update migration label
  const { metadata } = await client.getMetadata({ trn });
  const existingLabels = metadata?.labels ?? {};

  await client.setMetadata({
    trn,
    labels: {
      ...existingLabels,
      "sdk-migration": `m${formatMigrationNumber(migrationNumber)}`,
    },
  });

  logger.success(
    `Migration checkpoint set to ${styles.bold(formatMigrationNumber(migrationNumber))} for namespace ${styles.bold(targetNamespace)}`,
  );
}

export const setCommand = defineCommand({
  meta: {
    name: "set",
    description: "Set migration checkpoint to a specific number",
  },
  args: {
    ...commonArgs,
    ...workspaceArgs,
    ...deploymentArgs,
    number: {
      type: "positional",
      description: "Migration number to set (e.g., 0001 or 1)",
      required: true,
    },
    namespace: {
      type: "string",
      description: "Target TailorDB namespace (required if multiple namespaces exist)",
      alias: "n",
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompt",
      alias: "y",
      default: false,
    },
  },
  run: withCommonArgs(async (args) => {
    const number = args._[0];
    if (!number) {
      throw new Error(
        "Migration number is required. Usage: tailor-sdk tailordb migration set <number>",
      );
    }

    await set({
      configPath: typeof args.config === "string" ? args.config : undefined,
      number: String(number),
      namespace: typeof args.namespace === "string" ? args.namespace : undefined,
      yes: Boolean(args.yes),
      workspaceId: typeof args["workspace-id"] === "string" ? args["workspace-id"] : undefined,
      profile: typeof args.profile === "string" ? args.profile : undefined,
    });
  }),
});
