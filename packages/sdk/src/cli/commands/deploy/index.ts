import { arg } from "politty";
import { z } from "zod";
import { deployFromCLI } from "#/cli/commands/deploy/deploy";
import { confirmationArgs, multiConfigArg, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { assertWritable } from "#/cli/shared/readonly-guard";

export const deployCommand = defineAppCommand({
  name: "deploy",
  description: "Deploy your application by applying the Tailor configuration.",
  args: z.strictObject({
    ...workspaceArgs,
    ...multiConfigArg,
    ...confirmationArgs,
    "create-workspace": arg(z.boolean().optional(), {
      description: "Create a workspace when the account has none",
    }),
    "workspace-name": arg(z.string().optional(), {
      description: "Name for a workspace created during deploy",
    }),
    "workspace-region": arg(z.string().optional(), {
      description: "Region for a workspace created during deploy",
    }),
    "organization-id": arg(z.string().optional(), {
      description: "Organization ID for a workspace created during deploy",
      env: "TAILOR_PLATFORM_ORGANIZATION_ID",
    }),
    "folder-id": arg(z.string().optional(), {
      description: "Folder ID for a workspace created during deploy",
      env: "TAILOR_PLATFORM_FOLDER_ID",
    }),
    "dry-run": arg(z.boolean().optional(), {
      alias: "d",
      description: "Run the command without making any changes",
    }),
    "no-schema-check": arg(z.boolean().optional(), {
      description: "Skip schema diff check against migration snapshots",
    }),
    "no-validate": arg(z.boolean().optional(), {
      description: "Skip client-side validation against platform resource constraints",
    }),
    "no-cache": arg(z.boolean().optional(), {
      description: "Disable bundle caching for this run",
    }),
    "clean-cache": arg(z.boolean().optional(), {
      description: "Clean the bundle cache before building",
    }),
  }),
  run: async (args) => {
    await assertWritable({ profile: args.profile });
    const { initTelemetry } = await import("#/cli/telemetry/index");
    await initTelemetry();
    await deployFromCLI(
      {
        workspaceId: args["workspace-id"],
        profile: args.profile,
        configPath: args.config,
        dryRun: args["dry-run"],
        yes: args.yes,
        createWorkspace: args["create-workspace"],
        workspaceName: args["workspace-name"],
        workspaceRegion: args["workspace-region"],
        organizationId: args["organization-id"],
        folderId: args["folder-id"],
        noSchemaCheck: args["no-schema-check"],
        noValidate: args["no-validate"],
        noCache: args["no-cache"],
        cleanCache: args["clean-cache"],
      },
      {
        envFile: args["env-file"],
        envFileIfExists: args["env-file-if-exists"],
        verbose: args.verbose,
        json: args.json,
      },
    );
  },
});
