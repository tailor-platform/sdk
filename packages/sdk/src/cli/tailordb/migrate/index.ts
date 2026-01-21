/**
 * TailorDB migration command
 *
 * Subcommands:
 * - generate: Generate migration files from schema differences
 * - set: Set migration checkpoint to a specific number
 * - status: Show migration status for TailorDB namespaces
 */

import { defineCommand } from "citty";
import { generateCommand } from "./generate";
import { setCommand } from "./set";
import { statusCommand } from "./status";

export const migrationCommand = defineCommand({
  meta: {
    name: "migration",
    description: "Manage TailorDB schema migrations (beta)",
  },
  subCommands: {
    generate: generateCommand,
    set: setCommand,
    status: statusCommand,
  },
});

export { generateCommand } from "./generate";
export type { GenerateOptions } from "./generate";
export { setCommand } from "./set";
export type { SetOptions } from "./set";
export { statusCommand } from "./status";
export type { StatusOptions } from "./status";
