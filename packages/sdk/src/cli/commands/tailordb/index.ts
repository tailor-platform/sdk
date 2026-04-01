import { defineCommand } from "politty";
import { erdCommand } from "./erd";
import { migrationCommand } from "./migrate";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  name: "tailordb",
  description: "Manage TailorDB tables and data.",
  subCommands: {
    truncate: truncateCommand,
    migration: migrationCommand,
    erd: erdCommand,
  },
});
