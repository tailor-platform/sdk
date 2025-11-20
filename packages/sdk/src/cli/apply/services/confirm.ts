import chalk from "chalk";
import { consola } from "consola";
import ml from "multiline-ts";

export interface OwnershipConflict {
  resourceType: string;
  resourceName: string;
  currentOwner: string;
  newOwner: string;
}

export interface UnlabeledResource {
  resourceType: string;
  resourceName: string;
}

/**
 * Confirms with the user whether to take ownership of resources managed by other applications.
 * In CI/CD mode (skipPrompt=true), automatically proceeds with ownership transfer.
 *
 * @param conflicts - List of resources with ownership conflicts
 * @param skipPrompt - If true, skip confirmation prompt (for --yes flag)
 * @throws Error if user declines to take ownership
 */
export async function confirmOwnershipConflicts(
  conflicts: OwnershipConflict[],
  skipPrompt: boolean,
): Promise<void> {
  if (conflicts.length === 0) return;

  // Display conflicts
  consola.warn("Resource ownership conflicts detected:");
  for (const c of conflicts) {
    console.log(ml`
      ${chalk.bold(c.resourceType)} ${chalk.cyan(`"${c.resourceName}"`)}
        Currently managed by: ${chalk.yellow(`"${c.currentOwner}"`)}
        New owner would be: ${chalk.green(`"${c.newOwner}"`)}
    `);
  }

  if (skipPrompt) {
    consola.success("Taking ownership (--yes flag specified)...");
    return;
  }

  const confirmed = await consola.prompt(
    `Take ownership of these ${conflicts.length} resource(s) and update them?`,
    { type: "confirm" },
  );

  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain managed by their current applications.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}

/**
 * Confirms with the user whether to add ownership labels to resources created before label tracking.
 * In CI/CD mode (skipPrompt=true), automatically adds labels.
 *
 * @param resources - List of resources without ownership labels
 * @param skipPrompt - If true, skip confirmation prompt (for --yes flag)
 * @throws Error if user declines to add labels
 */
export async function confirmUnlabeledResources(
  resources: UnlabeledResource[],
  skipPrompt: boolean,
): Promise<void> {
  if (resources.length === 0) return;

  consola.info("Resources without ownership tracking detected:");
  for (const r of resources) {
    console.log(
      `  ${chalk.bold(r.resourceType)} ${chalk.cyan(`"${r.resourceName}"`)}`,
    );
  }
  consola.info(
    "These resources were created before ownership tracking was introduced.",
  );

  if (skipPrompt) {
    consola.success("Adding ownership tracking (--yes flag specified)...");
    return;
  }

  const confirmed = await consola.prompt(
    "Add ownership tracking and continue?",
    {
      type: "confirm",
      initial: true, // Backward compatibility - default to Yes
    },
  );

  if (!confirmed) {
    throw new Error("Apply cancelled.");
  }
}
