import { arg } from "politty";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { getScopesFromWriteFlag, printCreatedToken } from "./transform";
import { createPatOperatorClient } from "./user";

export const createCommand = defineAppCommand({
  name: "create",
  description: "Create a new personal access token.",
  args: z.strictObject({
    name: arg(z.string(), {
      positional: true,
      description: "Token name",
    }),
    write: arg(z.boolean().default(false), {
      alias: "W",
      description: "Grant write permission (default: read-only)",
    }),
    profile: workspaceArgs.profile,
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const client = await createPatOperatorClient(args.profile);

    const scopes = getScopesFromWriteFlag(args.write);
    const result = await client.createPersonalAccessToken({
      name: args.name,
      scopes,
    });

    if (!result.accessToken) {
      throw new Error("Failed to create personal access token");
    }

    printCreatedToken(args.name, result.accessToken, args.write, "created");
  },
});
