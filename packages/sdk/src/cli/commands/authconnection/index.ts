import { defineCommand, runCommand } from "politty";
import { authorizeAuthConnectionCommand } from "./authorize";
import { createAuthConnectionCommand } from "./create";
import { listAuthConnectionCommand } from "./list";
import { revokeAuthConnectionCommand } from "./revoke";

export const authconnectionCommand = defineCommand({
  name: "authconnection",
  description: "Manage auth connections.",
  subCommands: {
    authorize: authorizeAuthConnectionCommand,
    create: createAuthConnectionCommand,
    list: listAuthConnectionCommand,
    revoke: revokeAuthConnectionCommand,
  },
  async run() {
    await runCommand(listAuthConnectionCommand, []);
  },
});
