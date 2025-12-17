import { defineCommand } from "citty";
import { deployCommand } from "./deploy";
import { getCommand } from "./get";

export const staticwebsiteCommand = defineCommand({
  meta: {
    name: "staticwebsite",
    description: "Manage static websites",
  },
  subCommands: {
    deploy: deployCommand,
    get: getCommand,
  },
});
