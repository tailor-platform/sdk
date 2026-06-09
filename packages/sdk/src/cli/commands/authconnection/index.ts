import { defineCommand, runCommand } from "politty";
import { authorizeAuthConnectionCommand } from "./authorize";
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
  },
  async run() {
    await runCommand(listAuthConnectionCommand, []);
  },
});
