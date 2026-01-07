import { defineCommand } from "citty";
import { migrateCommand } from "./migrate";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  meta: {
    name: "tailordb",
    description: "Manage TailorDB tables and data",
  },
  subCommands: {
    migrate: migrateCommand,
    truncate: truncateCommand,
  },
});
