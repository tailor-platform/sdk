import { defineCommand } from "@politty/zod";
import { domainGetCommand } from "./get";
import { domainListCommand } from "./list";

export const domainCommand = defineCommand({
  name: "domain",
  description: "Manage custom domains for static websites.",
  subCommands: {
    list: domainListCommand,
    get: domainGetCommand,
  },
});
