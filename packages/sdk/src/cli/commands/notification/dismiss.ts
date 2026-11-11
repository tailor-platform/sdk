import { arg } from "@politty/zod";
import { z } from "zod";
import { workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { printMutationResult } from "#/cli/shared/mutation-result";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { createNotificationClient } from "./client";
import { rethrowNotificationError } from "./errors";

export const dismissCommand = defineAppCommand({
  name: "dismiss",
  description: "Remove a notification from your inbox.",
  args: z.strictObject({
    id: arg(z.uuid(), {
      positional: true,
      description: "Notification ID",
    }),
    profile: workspaceArgs.profile,
  }),
  run: async (args) => {
    // Dismissing cannot be undone, so a read-only profile refuses it here.
    await assertWritable({ profile: args.profile });
    const client = await createNotificationClient(args.profile);

    try {
      await client.dismissMyNotification({ notificationId: args.id });
    } catch (error) {
      rethrowNotificationError(args.id, error);
    }

    logger.success(`Notification "${args.id}" dismissed.`);
    printMutationResult({ changed: true, id: args.id });
  },
});
