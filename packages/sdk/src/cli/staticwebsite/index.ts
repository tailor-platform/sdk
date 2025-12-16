import { defineCommand } from "citty";
import { deployStaticWebsiteCommand } from "./deploy";
import { showCommand } from "./show";

export const staticwebsiteCommand = defineCommand({
  meta: {
    name: "staticwebsite",
    description: "Manage static websites",
  },
  subCommands: {
    show: showCommand,
    deploy: deployStaticWebsiteCommand,
  },
});
