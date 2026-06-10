import { defineCommand, runCommand } from "politty";
import { authorizeAuthConnectionCommand } from "./authorize";
import { deleteAuthConnectionCommand } from "./delete";
import { listAuthConnectionCommand } from "./list";
import { revokeAuthConnectionCommand } from "./revoke";

export const authconnectionCommand = defineCommand({
  name: "authconnection",
  description: "Manage auth connections.",
  subCommands: {
    authorize: authorizeAuthConnectionCommand,
    list: listAuthConnectionCommand,
    revoke: revokeAuthConnectionCommand,
    delete: deleteAuthConnectionCommand,
  },
  async run() {
    await runCommand(listAuthConnectionCommand, []);
  },
});
