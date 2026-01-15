import { defineCommand } from "citty";
import { migrationCommand } from "./migrate";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  meta: {
    name: "tailordb",
    description: "Manage TailorDB tables and data",
  },
  subCommands: {
    migration: migrationCommand,
    truncate: truncateCommand,
  },
});
