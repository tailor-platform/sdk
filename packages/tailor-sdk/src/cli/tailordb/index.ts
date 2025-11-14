import { defineCommand } from "citty";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  meta: {
    name: "tailordb",
    description: "Manage TailorDB tables and data",
  },
  subCommands: {
    truncate: truncateCommand,
  },
});
