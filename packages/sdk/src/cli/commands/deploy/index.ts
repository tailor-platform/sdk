import { arg } from "politty";
import { z } from "zod";
import { deploy } from "@/cli/commands/deploy/deploy";
import { confirmationArgs, deploymentArgs } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";

export const deployCommand = defineAppCommand({
  name: "deploy",
  aliases: ["apply"],
  description: "Deploy your application by applying the Tailor configuration.",
  args: z
    .object({
      ...deploymentArgs,
      ...confirmationArgs,
      "dry-run": arg(z.boolean().optional(), {
        alias: "d",
        description: "Run the command without making any changes",
      }),
      "no-schema-check": arg(z.boolean().optional(), {
        description: "Skip schema diff check against migration snapshots",
      }),
      "no-cache": arg(z.boolean().optional(), {
        description: "Disable bundle caching for this run",
      }),
      "clean-cache": arg(z.boolean().optional(), {
        description: "Clean the bundle cache before building",
      }),
    })
    .strict(),
  run: async (args) => {
    const { initTelemetry } = await import("@/cli/telemetry");
    await initTelemetry();
    await deploy({
      workspaceId: args["workspace-id"],
      profile: args.profile,
      configPath: args.config,
      dryRun: args["dry-run"],
      yes: args.yes,
      noSchemaCheck: args["no-schema-check"],
      noCache: args["no-cache"],
      cleanCache: args["clean-cache"],
    });
  },
});
