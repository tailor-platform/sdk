import { arg } from "@politty/valibot";
import * as v from "valibot";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { createPatOperatorClient } from "./user";

export const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete a personal access token.",
  args: v.strictObject({
    name: arg(v.string(), {
      positional: true,
      description: "Token name",
    }),
  }),
  run: async (args) => {
    await assertWritable();
    const client = await createPatOperatorClient();

    await client.deletePersonalAccessToken({
      name: args.name,
    });

    logger.success(`Personal access token "${args.name}" deleted successfully.`);
  },
});
