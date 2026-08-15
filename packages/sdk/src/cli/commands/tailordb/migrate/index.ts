/**
 * TailorDB migration command
 *
 * Subcommands:
 * - generate: Generate migration files from schema differences
 * - rebaseline: Collapse the full migration history into a new baseline
 * - script:   Add a migrate.ts template to an existing migration
 * - set:      Set migration checkpoint to a specific number
 * - status:   Show migration status for TailorDB namespaces
 * - sync:     Sync remote TailorDB schema to a specific migration snapshot
 * - test:     Test pending migrations in an isolated workspace
 * - validate: Validate migration files and detect schema drift without deploying
 */

import { defineCommand } from "@politty/valibot";
import { generateCommand } from "./generate";
import { rebaselineCommand } from "./rebaseline";
import { scriptCommand } from "./script";
import { setCommand } from "./set";
import { statusCommand } from "./status";
import { syncCommand } from "./sync";
import { testCommand } from "./test";
import { validateCommand } from "./validate";

export const migrationCommand = defineCommand({
  name: "migration",
  description: "Manage TailorDB schema migrations.",
  subCommands: {
    generate: generateCommand,
    rebaseline: rebaselineCommand,
    script: scriptCommand,
    set: setCommand,
    status: statusCommand,
    sync: syncCommand,
    test: testCommand,
    validate: validateCommand,
  },
});

export { generateCommand } from "./generate";
export { rebaselineCommand } from "./rebaseline";
export { scriptCommand } from "./script";
export { setCommand } from "./set";
export { statusCommand } from "./status";
export { syncCommand } from "./sync";
export { testCommand } from "./test";
export { validateCommand } from "./validate";
