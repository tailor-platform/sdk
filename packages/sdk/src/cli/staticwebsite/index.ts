import { defineCommand } from "citty";
import { deployStaticWebsiteCommand } from "./deploy";

export const staticwebsiteCommand = defineCommand({
  meta: {
    name: "static-website",
    description: "Manage static websites",
  },
  subCommands: {
    deploy: deployStaticWebsiteCommand,
  },
  async run() {
    // await runCommand(listStaticWebsiteCommand, {rawArgs: []})
  },
});
