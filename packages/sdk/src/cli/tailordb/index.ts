import { defineCommand } from "citty";
import { erdCommand } from "./erd";
import { migrationCommand } from "./migrate";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  meta: {
    name: "tailordb",
    description: "Manage TailorDB tables and data",
  },
  subCommands: {
    erd: erdCommand,
    migration: migrationCommand,
    truncate: truncateCommand,
  },
});
