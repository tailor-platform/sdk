import { defineCommand } from "politty";
import { migrationCommand } from "./migrate";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  name: "tailordb",
  description: "Manage TailorDB tables and data.",
  notes:
    "The `tailordb erd` commands are provided by the @tailor-platform/sdk-plugin-tailordb-erd CLI plugin.",
  subCommands: {
    truncate: truncateCommand,
    migration: migrationCommand,
  },
});
