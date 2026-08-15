import { arg } from "@politty/valibot";
import * as v from "valibot";
import { deployFromCLI } from "#/cli/commands/deploy/deploy";
import { confirmationArgs, multiConfigArg, workspaceArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { assertWritable } from "#/cli/shared/readonly-guard";

export const deployCommand = defineAppCommand({
  name: "deploy",
  description: "Deploy your application by applying the Tailor configuration.",
  args: v.strictObject({
    ...workspaceArgs,
    ...multiConfigArg,
    ...confirmationArgs,
    "create-workspace": arg(v.optional(v.boolean()), {
      description: "Create a workspace when the account has none",
    }),
    "workspace-name": arg(v.optional(v.string()), {
      description: "Name for a workspace created during deploy",
    }),
    "workspace-region": arg(v.optional(v.string()), {
      description: "Region for a workspace created during deploy",
    }),
    "organization-id": arg(v.optional(v.string()), {
      description: "Organization ID for a workspace created during deploy",
      env: "TAILOR_PLATFORM_ORGANIZATION_ID",
    }),
    "folder-id": arg(v.optional(v.string()), {
      description: "Folder ID for a workspace created during deploy",
      env: "TAILOR_PLATFORM_FOLDER_ID",
    }),
    "dry-run": arg(v.optional(v.boolean()), {
      alias: "d",
      description: "Run the command without making any changes",
    }),
    "no-schema-check": arg(v.optional(v.boolean()), {
      description: "Skip schema diff check against migration snapshots",
    }),
    "no-validate": arg(v.optional(v.boolean()), {
      description: "Skip client-side validation against platform resource constraints",
    }),
    "no-cache": arg(v.optional(v.boolean()), {
      description: "Disable bundle caching for this run",
    }),
    "clean-cache": arg(v.optional(v.boolean()), {
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
