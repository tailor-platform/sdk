import { defineCommand } from "@politty/zod";
import { authorizeAuthConnectionCommand } from "./authorize";
import { deleteAuthConnectionCommand } from "./delete";
import { listAuthConnectionCommand } from "./list";
import { openAuthConnectionCommand } from "./open";
import { revokeAuthConnectionCommand } from "./revoke";

export const authconnectionCommand = defineCommand({
  name: "authconnection",
  description: "Manage auth connections.",
  subCommands: {
    authorize: authorizeAuthConnectionCommand,
    list: listAuthConnectionCommand,
    open: openAuthConnectionCommand,
    revoke: revokeAuthConnectionCommand,
    delete: deleteAuthConnectionCommand,
  },
  defaultSubCommand: "list",
});
