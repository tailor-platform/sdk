/**
 * TailorDB migrate command
 *
 * Subcommands:
 * - generate: Generate migration files from schema differences
 */

import { defineCommand } from "citty";
import { generateCommand } from "./generate";

export const migrateCommand = defineCommand({
  meta: {
    name: "migrate",
    description: "Manage TailorDB schema migrations",
  },
  subCommands: {
    generate: generateCommand,
  },
});

export { generateCommand } from "./generate";
export type { GenerateOptions } from "./generate";
