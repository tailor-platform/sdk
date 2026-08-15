import { arg } from "@politty/valibot";
import * as v from "valibot";
import { defineAppCommand } from "#/cli/shared/command";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { getScopesFromWriteFlag, printCreatedToken } from "./transform";
import { createPatOperatorClient } from "./user";

export const updateCommand = defineAppCommand({
  name: "update",
  description: "Update a personal access token (delete and recreate).",
  args: v.strictObject({
    name: arg(v.string(), {
      positional: true,
      description: "Token name",
    }),
    write: arg(v.optional(v.boolean(), false), {
      alias: "W",
      description: "Grant write permission (if not specified, keeps read-only)",
    }),
  }),
  run: async (args) => {
    await assertWritable();
    const client = await createPatOperatorClient();

    // Delete the existing token
    await client.deletePersonalAccessToken({
      name: args.name,
    });

    // Create a new token with the same name
    const scopes = getScopesFromWriteFlag(args.write);
    const result = await client.createPersonalAccessToken({
      name: args.name,
      scopes,
    });

    if (!result.accessToken) {
      throw new Error("Failed to create personal access token");
    }

    printCreatedToken(args.name, result.accessToken, args.write, "updated");
  },
});
