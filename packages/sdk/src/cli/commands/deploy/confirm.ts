import { styles, logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import ml from "#/utils/multiline";

export interface OwnerConflict {
  resourceType: string;
  resourceName: string;
  currentOwner: string;
}

export interface UnmanagedResource {
  resourceType: string;
  resourceName: string;
}

/**
 * Confirm reassignment of resources when owner conflicts are detected.
 * Splits into three scenarios, each with its own prompt because the
 * user-facing meaning is different: the resource carries the same sdk-name and
 * an sdk-app-id the config does not match, either because the config now holds
 * a different id (regeneration) or because it holds none at all; or the
 * resource carries a different sdk-name (name mismatch).
 * @param conflicts - Detected owner conflicts
 * @param appName - Target application name
 * @param yes - Whether to auto-confirm without prompting
 * @param appId - Target application id, when the config resolves to one
 * @returns Promise that resolves when confirmation completes
 */
export async function confirmOwnerConflict(
  conflicts: OwnerConflict[],
  appName: string,
  yes: boolean,
  appId?: string,
): Promise<void> {
  if (conflicts.length === 0) return;

  // Same sdk-name as the target app -> the resources carry an id this config
  // does not: either a new one replaced it, or the config has none at all.
  const idMismatches = conflicts.filter((c) => c.currentOwner === appName);
  const nameMismatches = conflicts.filter((c) => c.currentOwner !== appName);

  if (idMismatches.length > 0) {
    await (appId
      ? confirmIdRegeneration(idMismatches, appName, yes)
      : confirmMissingConfigId(idMismatches, appName, yes));
  }
  if (nameMismatches.length > 0) {
    await confirmNameMismatch(nameMismatches, appName, yes);
  }
}

async function confirmIdRegeneration(
  conflicts: OwnerConflict[],
  appName: string,
  yes: boolean,
): Promise<void> {
  logIdMismatch(`Application id was regenerated for "${appName}":`, conflicts);

  if (yes) {
    logger.success("Re-tagging resources with the new id (--yes flag specified)...", {
      mode: "plain",
    });
    return;
  }

  const confirmed = await prompt.confirm({
    message: `Re-tag these resources with the new id for "${appName}"?\n${styles.dim("(The id in tailor.config.ts was removed since the previous deploy, so a new one was generated)")}`,
    default: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain tagged with the previous id.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}

function logIdMismatch(heading: string, conflicts: OwnerConflict[]): void {
  logger.warn(heading);
  logger.log("  These resources are tagged with an id from an earlier deploy.");
  logger.newline();
  logger.log(`  ${styles.info("Resources")}:`);
  for (const c of conflicts) {
    logger.log(`    • ${styles.bold(c.resourceType)} ${styles.info(`"${c.resourceName}"`)}`);
  }
}

async function confirmMissingConfigId(
  conflicts: OwnerConflict[],
  appName: string,
  yes: boolean,
): Promise<void> {
  logIdMismatch(`No application id resolved for "${appName}":`, conflicts);

  if (yes) {
    logger.success("Managing these resources by name (--yes flag specified)...", { mode: "plain" });
    return;
  }

  const confirmed = await prompt.confirm({
    message: `Drop that id and manage these resources by name for "${appName}"?\n${styles.dim("(the config resolves without an 'id', so ownership falls back to the application name)")}`,
    default: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain tagged with their current id.
      Restore the 'id' in your config to keep owning them by id, or run again and confirm to own them by name.
    `);
  }
}

async function confirmNameMismatch(
  conflicts: OwnerConflict[],
  appName: string,
  yes: boolean,
): Promise<void> {
  const currentOwners = [...new Set(conflicts.map((c) => c.currentOwner))];

  logger.warn("Application name mismatch detected:");

  logger.log(
    `  ${styles.warning("Current application(s)")}: ${currentOwners.map((o) => styles.bold(`"${o}"`)).join(", ")}`,
  );
  logger.log(`  ${styles.success("New application")}:        ${styles.bold(`"${appName}"`)}`);
  logger.newline();
  logger.log(`  ${styles.info("Resources")}:`);
  for (const c of conflicts) {
    logger.log(`    • ${styles.bold(c.resourceType)} ${styles.info(`"${c.resourceName}"`)}`);
  }

  if (yes) {
    logger.success("Updating resources (--yes flag specified)...", {
      mode: "plain",
    });
    return;
  }

  const promptMessage =
    currentOwners.length === 1
      ? `Update these resources to be managed by "${appName}"?\n${styles.dim("(Common when renaming your application)")}`
      : `Update these resources to be managed by "${appName}"?`;
  const confirmed = await prompt.confirm({
    message: promptMessage,
    default: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain managed by their current applications.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}

/**
 * Confirm allowing tailor to manage previously unmanaged resources.
 * @param resources - Unmanaged resources
 * @param appName - Target application name
 * @param yes - Whether to auto-confirm without prompting
 * @returns Promise that resolves when confirmation completes
 */
export async function confirmUnmanagedResources(
  resources: UnmanagedResource[],
  appName: string,
  yes: boolean,
): Promise<void> {
  if (resources.length === 0) return;

  logger.warn("Existing resources not tracked by tailor were found:");

  logger.log(`  ${styles.info("Resources")}:`);
  for (const r of resources) {
    logger.log(`    • ${styles.bold(r.resourceType)} ${styles.info(`"${r.resourceName}"`)}`);
  }
  logger.newline();
  logger.log("  These resources may have been created by older SDK versions, Terraform, or CUE.");
  logger.log("  To continue, confirm that tailor should manage them.");
  logger.log(
    "  If they are managed by another tool (e.g., Terraform), cancel and manage them there instead.",
  );

  if (yes) {
    logger.success(`Adding to "${appName}" (--yes flag specified)...`, {
      mode: "plain",
    });
    return;
  }

  const confirmed = await prompt.confirm({
    message: `Allow tailor to manage these resources for "${appName}"?`,
    default: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain unmanaged.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}

export interface ImportantResourceDeletion {
  resourceType: string;
  resourceName: string;
}

/**
 * Confirm deletion of important resources.
 * @param resources - Resources scheduled for deletion
 * @param yes - Whether to auto-confirm without prompting
 * @returns Promise that resolves when confirmation completes
 */
export async function confirmImportantResourceDeletion(
  resources: ImportantResourceDeletion[],
  yes: boolean,
): Promise<void> {
  if (resources.length === 0) return;

  logger.warn("The following resources will be deleted:");

  logger.log(`  ${styles.info("Resources")}:`);
  for (const r of resources) {
    logger.log(`    • ${styles.bold(r.resourceType)} ${styles.error(`"${r.resourceName}"`)}`);
  }
  logger.newline();
  logger.log(
    styles.warning("  Deleting these resources will permanently remove all associated data."),
  );

  if (yes) {
    logger.success("Deleting resources (--yes flag specified)...", {
      mode: "plain",
    });
    return;
  }

  const confirmed = await prompt.confirm({
    message: "Are you sure you want to delete these resources?",
    default: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources will not be deleted.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}

/** An application recorded as needing to take part in this deploy, but absent. */
export interface MissingDependentApp {
  /** Application whose resources are applied differently without the dependent. */
  appName: string;
  /** Stable id of the absent application. */
  appId: string;
  /** Why it has to take part in the same deploy. */
  reason: string;
}

/**
 * Confirm continuing without an application recorded as a dependency.
 *
 * A previous deploy recorded that another config's executors make this config's
 * resources publish events. Applying this config alone resolves those flags from
 * a smaller set of executors, which turns publishing off.
 * @param missing - Recorded dependencies absent from this deploy
 * @param yes - Whether `--yes` was passed
 * @returns Promise that resolves when the deploy may continue
 */
export async function confirmMissingDependentApps(
  missing: MissingDependentApp[],
  yes: boolean,
): Promise<void> {
  if (missing.length === 0) return;

  logger.warn("Configs recorded as depending on this deploy are missing:");
  for (const entry of missing) {
    logger.log(
      `    • application id ${styles.info(entry.appId)} depends on ${styles.bold(entry.appName)} (${entry.reason})`,
    );
  }
  logger.newline();
  logger.log("  Applying without them turns off event publishing they enabled.");
  logger.log("  To keep it, add their configs to --config, or set publishEvents explicitly.");

  if (yes) {
    logger.warn("Continuing without them (--yes flag specified); event publishing may turn off.");
    return;
  }

  const confirmed = await prompt.confirm({
    message: "Continue without them?",
    default: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Add the missing configs to --config, or set publishEvents
      explicitly on the resources that should keep publishing.
    `);
  }
}
