import chalk from "chalk";
import { consola } from "consola";
import ml from "multiline-ts";

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

  consola.warn("Application name mismatch detected:");

  console.log(
    `  ${chalk.yellow("Current application(s)")}: ${currentOwners.map((o) => chalk.bold(`"${o}"`)).join(", ")}`,
  );
  console.log(
    `  ${chalk.green("New application")}:        ${chalk.bold(`"${appName}"`)}`,
  );
  console.log("");
  console.log(`  ${chalk.cyan("Resources")}:`);
  for (const c of conflicts) {
    console.log(
      `    • ${chalk.bold(c.resourceType)} ${chalk.cyan(`"${c.resourceName}"`)}`,
    );
  }

  if (yes) {
    consola.success("Updating resources (--yes flag specified)...");
    return;
  }

  const promptMessage =
    currentOwners.length === 1
      ? `Update these resources to be managed by "${appName}"?\n${chalk.gray("(Common when renaming your application)")}`
      : `Update these resources to be managed by "${appName}"?`;
  const confirmed = await consola.prompt(promptMessage, {
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

  consola.warn("Unmanaged resources detected:");

  console.log(`  ${chalk.cyan("Resources")}:`);
  for (const r of resources) {
    console.log(
      `    • ${chalk.bold(r.resourceType)} ${chalk.cyan(`"${r.resourceName}"`)}`,
    );
  }
  console.log("");
  console.log("  These resources are not managed by any application.");

  if (yes) {
    consola.success(`Adding to "${appName}" (--yes flag specified)...`);
    return;
  }

  const confirmed = await consola.prompt(
    `Add these resources to "${appName}"?`,
    { type: "confirm", initial: false },
  );
  if (!confirmed) {
    throw new Error(ml`
      Apply cancelled. Resources remain unmanaged.
      To override, run again and confirm, or use --yes flag.
    `);
  }
}
