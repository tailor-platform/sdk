import { arg } from "@politty/zod";
import { z } from "zod";
import { deployFromCLI } from "#/cli/commands/deploy/deploy";
import { parseMigrationSkipSteps } from "#/cli/commands/deploy/tailordb/migration-skip-steps";
import {
  confirmationArgs,
  DEFAULT_CONFIG_PATH,
  readEnvFileArgs,
  locationIds,
  multiConfigArg,
  readDeployConfigPathEnv,
  workspaceArgs,
} from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { assertWritable } from "#/cli/shared/readonly-guard";

export const deployCommand = defineAppCommand({
  name: "deploy",
  description: "Deploy your application by applying the Tailor configuration.",
  notes:
    "Every workspace belongs to an organization; when none is given or set as a default, interactive runs ask for one and non-interactive runs fail. Workspace creation uses the selected user's default organization and folder set by `user update` when neither location is given and TAILOR_PLATFORM_TOKEN is not set. Giving --organization-id or --folder-id replaces both defaults. TAILOR_PLATFORM_ORGANIZATION_ID and TAILOR_PLATFORM_FOLDER_ID, including values loaded by --env-file, also replace the defaults; command-line options take precedence, and an empty value of either variable is ignored. With --create-workspace, an existing workspace must match the resolved name, region, organization, and folder to be reused.",
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
      description: "Skip schema diff check against migration snapshots (beta)",
    }),
    "migration-skip-steps": arg(z.string().optional(), {
      description:
        "Skip steps of a partially applied multi-step migration that already succeeded, as comma-separated namespace/step entries (beta)",
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
        configPath:
          args.$source?.("config") === "cli"
            ? args.config
            : (readDeployConfigPathEnv() ?? DEFAULT_CONFIG_PATH),
        dryRun: args["dry-run"],
        yes: args.yes,
        createWorkspace: args["create-workspace"],
        workspaceName: args["workspace-name"],
        workspaceRegion: args["workspace-region"],
        ...locationIds(args),
        noSchemaCheck: args["no-schema-check"],
        migrationSkipSteps: parseMigrationSkipSteps(args["migration-skip-steps"]),
        noValidate: args["no-validate"],
        noCache: args["no-cache"],
        cleanCache: args["clean-cache"],
      },
      {
        // Parsed values drop the occurrences given before the subcommand name.
        ...readEnvFileArgs(process.argv.slice(2)),
        verbose: args.verbose,
        json: args.json,
      },
    );
  },
});
