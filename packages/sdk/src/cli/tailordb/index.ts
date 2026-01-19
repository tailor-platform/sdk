import { defineCommand } from "citty";
import { erdCommand } from "./erd";
import { truncateCommand } from "./truncate";

export const tailordbCommand = defineCommand({
  meta: {
    name: "tailordb",
    description: "Manage TailorDB tables and data",
  },
  subCommands: {
    erd: erdCommand,
    truncate: truncateCommand,
  },
});
