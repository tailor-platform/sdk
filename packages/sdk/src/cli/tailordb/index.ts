import { defineCommand } from "politty";
import { erdCommand } from "./erd";
import { migrationCommand } from "./migrate";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  name: "tailordb",
  description: "Manage TailorDB tables and data",
  subCommands: {
    erd: erdCommand,
    migration: migrationCommand,
    truncate: truncateCommand,
  },
});
