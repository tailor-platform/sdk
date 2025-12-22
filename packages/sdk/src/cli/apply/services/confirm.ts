import ml from "multiline-ts";
import { styles, logger } from "../../utils/logger";

export interface OwnerConflict {
  resourceType: string;
  resourceName: string;
  currentOwner: string;
}

export interface UnmanagedResource {
  resourceType: string;
  resourceName: string;
}

export async function confirmOwnerConflict(
  conflicts: OwnerConflict[],
  appName: string,
  yes: boolean,
): Promise<void> {
  if (conflicts.length === 0) return;

  const currentOwners = [...new Set(conflicts.map((c) => c.currentOwner))];

  logger.warn("Application name mismatch detected:");

  logger.log(
    `  ${styles.warning("Current application(s)")}: ${currentOwners.map((o) => styles.bold(`"${o}"`)).join(", ")}`,
  );
  logger.log(
    `  ${styles.success("New application")}:        ${styles.bold(`"${appName}"`)}`,
  );
  logger.newline();
  logger.log(`  ${styles.info("Resources")}:`);
  for (const c of conflicts) {
    logger.log(
      `    • ${styles.bold(c.resourceType)} ${styles.info(`"${c.resourceName}"`)}`,
    );
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
  const confirmed = await logger.prompt(promptMessage, {
    type: "confirm",
    initial: false,
  });
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain managed by their current applications.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}

export async function confirmUnmanagedResources(
  resources: UnmanagedResource[],
  appName: string,
  yes: boolean,
): Promise<void> {
  if (resources.length === 0) return;

  logger.warn("Resources not managed by any application were found:");

  logger.log(`  ${styles.info("Resources")}:`);
  for (const r of resources) {
    logger.log(
      `    • ${styles.bold(r.resourceType)} ${styles.info(`"${r.resourceName}"`)}`,
    );
  }
  logger.newline();
  logger.log(
    "  These existing resources are currently not managed by any application.",
  );
  logger.log(
    "  To continue this apply, you need to allow this project's application to manage these resources.",
  );
  logger.log(
    "  If you want to manage them with a different application, cancel this apply and run it from that project instead.",
  );

  if (yes) {
    logger.success(`Adding to "${appName}" (--yes flag specified)...`, {
      mode: "plain",
    });
    return;
  }

  const confirmed = await logger.prompt(
    `Allow "${appName}" (this project's application) to manage these resources?`,
    { type: "confirm", initial: false },
  );
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

export async function confirmImportantResourceDeletion(
  resources: ImportantResourceDeletion[],
  yes: boolean,
): Promise<void> {
  if (resources.length === 0) return;

  logger.warn("The following resources will be deleted:");

  logger.log(`  ${styles.info("Resources")}:`);
  for (const r of resources) {
    logger.log(
      `    • ${styles.bold(r.resourceType)} ${styles.error(`"${r.resourceName}"`)}`,
    );
  }
  logger.newline();
  logger.log(
    styles.warning(
      "  Deleting these resources will permanently remove all associated data.",
    ),
  );

  if (yes) {
    logger.success("Deleting resources (--yes flag specified)...", {
      mode: "plain",
    });
    return;
  }

  const confirmed = await logger.prompt(
    "Are you sure you want to delete these resources?",
    { type: "confirm", initial: false },
  );
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources will not be deleted.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}
