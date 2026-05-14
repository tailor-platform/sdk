import { styles, logger } from "@/cli/shared/logger";
import { prompt } from "@/cli/shared/prompt";
import ml from "@/utils/multiline";

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
 * Splits into two scenarios: id regeneration (same sdk-name, different
 * sdk-app-id) and name mismatch (different sdk-name). Each gets its own
 * prompt because the user-facing meaning is different.
 * @param conflicts - Detected owner conflicts
 * @param appName - Target application name
 * @param yes - Whether to auto-confirm without prompting
 * @returns Promise that resolves when confirmation completes
 */
export async function confirmOwnerConflict(
  conflicts: OwnerConflict[],
  appName: string,
  yes: boolean,
): Promise<void> {
  if (conflicts.length === 0) return;

  // Same sdk-name as the target app -> the app's id was regenerated
  // (typically because the user deleted the id from tailor.config.ts).
  const idRegenerated = conflicts.filter((c) => c.currentOwner === appName);
  const nameMismatches = conflicts.filter((c) => c.currentOwner !== appName);

  if (idRegenerated.length > 0) {
    await confirmIdRegeneration(idRegenerated, appName, yes);
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
  logger.warn(`Application id was regenerated for "${appName}":`);
  logger.log("  These resources still carry the previous id.");
  logger.newline();
  logger.log(`  ${styles.info("Resources")}:`);
  for (const c of conflicts) {
    logger.log(`    • ${styles.bold(c.resourceType)} ${styles.info(`"${c.resourceName}"`)}`);
  }

  if (yes) {
    logger.success("Re-tagging resources with the new id (--yes flag specified)...", {
      mode: "plain",
    });
    return;
  }

  const confirmed = await prompt.confirm({
    message: `Re-tag these resources with the new id for "${appName}"?\n${styles.dim("(Common when the id was deleted from tailor.config.ts to reset identity)")}`,
    default: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain tagged with the previous id.
      To override, run again and confirm, or use --yes flag.
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
 * Confirm allowing tailor-sdk to manage previously unmanaged resources.
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

  logger.warn("Existing resources not tracked by tailor-sdk were found:");

  logger.log(`  ${styles.info("Resources")}:`);
  for (const r of resources) {
    logger.log(`    • ${styles.bold(r.resourceType)} ${styles.info(`"${r.resourceName}"`)}`);
  }
  logger.newline();
  logger.log("  These resources may have been created by older SDK versions, Terraform, or CUE.");
  logger.log("  To continue, confirm that tailor-sdk should manage them.");
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
    message: `Allow tailor-sdk to manage these resources for "${appName}"?`,
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
