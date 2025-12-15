import { defineCommand } from "citty";
import { deployStaticWebsiteCommand } from "./deploy";

export const staticwebsiteCommand = defineCommand({
  meta: {
    name: "staticwebsite",
    description: "Manage static websites",
  },
  subCommands: {
    deploy: deployStaticWebsiteCommand,
  },
});
