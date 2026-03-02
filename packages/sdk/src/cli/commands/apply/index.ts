import { defineCommand, arg } from "politty";
import { z } from "zod";
import { apply } from "@/cli/commands/apply/apply";
import { commonArgs, confirmationArgs, deploymentArgs, withCommonArgs } from "@/cli/shared/args";

export const applyCommand = defineCommand({
  name: "apply",
  description: "Apply Tailor configuration to deploy your application.",
  args: z.object({
    ...commonArgs,
    ...deploymentArgs,
    ...confirmationArgs,
    "dry-run": arg(z.boolean().optional(), {
      alias: "d",
      description: "Run the command without making any changes",
    }),
    "no-schema-check": arg(z.boolean().optional(), {
      description: "Skip schema diff check against migration snapshots",
    }),
  }),
  run: withCommonArgs(async (args) => {
    await apply({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      dryRun: args["dry-run"],
      yes: args.yes,
      noSchemaCheck: args["no-schema-check"],
    });
  }),
});
