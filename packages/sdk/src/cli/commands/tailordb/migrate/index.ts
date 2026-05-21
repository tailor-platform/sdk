/**
 * TailorDB migration command
 *
 * Subcommands:
 * - generate: Generate migration files from schema differences
 * - script:   Add a migrate.ts template to an existing migration
 * - set:      Set migration checkpoint to a specific number
 * - status:   Show migration status for TailorDB namespaces
 */

import { defineCommand } from "politty";
import { generateCommand } from "./generate";
import { scriptCommand } from "./script";
import { setCommand } from "./set";
import { statusCommand } from "./status";

export const migrationCommand = defineCommand({
  name: "migration",
  description: "Manage TailorDB schema migrations.",
  subCommands: {
    generate: generateCommand,
    script: scriptCommand,
    set: setCommand,
    status: statusCommand,
  },
});

export { generateCommand } from "./generate";
export type { GenerateOptions } from "./generate";
export { scriptCommand } from "./script";
export type { ScriptOptions } from "./script";
export { setCommand } from "./set";
export type { SetOptions } from "./set";
export { statusCommand } from "./status";
export type { StatusOptions } from "./status";
