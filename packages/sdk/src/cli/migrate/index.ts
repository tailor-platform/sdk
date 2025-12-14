import { defineCommand } from "citty";
import { createMigrationCommand } from "./create";

export const migrateCommand = defineCommand({
  meta: {
    name: "migrate",
    description:
      "Apply schema changes to Tailor DB and generate migration files",
  },
  subCommands: {
    create: createMigrationCommand,
  },
});
