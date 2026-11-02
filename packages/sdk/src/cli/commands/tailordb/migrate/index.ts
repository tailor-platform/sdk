/**
 * TailorDB migration command
 *
 * Subcommands:
 * - generate: Generate migration files from schema differences
 * - rebaseline: Collapse the full migration history into a new baseline
 * - resolve:  Settle a migration that a failed deploy left partially applied
 * - script:   Add a migrate.ts template to an existing migration
 * - status:   Show migration status for TailorDB namespaces
 * - sync:     Sync remote TailorDB schema to a specific migration snapshot
 * - test:     Test pending migrations in an isolated workspace
 * - validate: Validate migration files and detect schema drift without deploying
 */

import { defineCommand } from "@politty/zod";
import { generateCommand } from "./generate";
import { type MigrationSubcommand } from "./hints";
import { rebaselineCommand } from "./rebaseline";
import { resolveCommand } from "./resolve";
import { scriptCommand } from "./script";
import { statusCommand } from "./status";
import { syncCommand } from "./sync";
import { testCommand } from "./test";
import { validateCommand } from "./validate";

export const migrationCommand = defineCommand({
  name: "migration",
  description: "Manage TailorDB schema migrations (beta).",
  subCommands: {
    generate: generateCommand,
    rebaseline: rebaselineCommand,
    resolve: resolveCommand,
    script: scriptCommand,
    status: statusCommand,
    sync: syncCommand,
    test: testCommand,
    validate: validateCommand,
  } satisfies Record<MigrationSubcommand, unknown>,
});

export { generateCommand } from "./generate";
export { rebaselineCommand } from "./rebaseline";
export { scriptCommand } from "./script";
export { statusCommand } from "./status";
export { syncCommand } from "./sync";
export { testCommand } from "./test";
export { validateCommand } from "./validate";
