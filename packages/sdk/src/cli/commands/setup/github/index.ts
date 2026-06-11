import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { setupGitHub } from "./github";

export const githubCommand = defineAppCommand({
  name: "github",
  description: "Generate a GitHub Actions deploy workflow. (beta)",
  args: z
    .object({
      "workspace-name": arg(z.string().optional(), {
        alias: "n",
        description: "Workspace name (defaults to the config 'name')",
      }),
      "workspace-region": arg(z.string(), {
        alias: "r",
        description: "Workspace region",
      }),
      "organization-id": arg(z.string(), {
        alias: "o",
        description: "Organization ID",
      }),
      "folder-id": arg(z.string().optional(), {
        alias: "f",
        description: "Folder ID",
      }),
      branch: arg(z.string().optional(), {
        description:
          "Branch target: deploy trigger branch (defaults to the detected default branch). " +
          "Tag target: tag-reachability guard branch (no guard when omitted)",
      }),
      tag: arg(z.boolean().default(false), {
        description: "Generate a tag target (deploy on tag push)",
      }),
      "tag-pattern": arg(z.string().optional(), {
        description: "Tag glob to match (requires --tag; defaults to v*)",
      }),
      environment: arg(z.string().optional(), {
        description: "GitHub Environment for the deploy job",
      }),
      "no-plan": arg(z.boolean().default(false), {
        description: "Disable the plan job for a branch target (cannot be combined with --tag)",
      }),
      dir: arg(z.string().default("."), {
        alias: "d",
        description: "App directory (for monorepo setups)",
      }),
      force: arg(z.boolean().default(false), {
        description: "Discard hand edits / take over unmanaged files and regenerate",
      }),
    })
    .strict(),
  run: async (args) => {
    if (args["tag-pattern"] !== undefined && !args.tag) {
      throw new Error("--tag-pattern requires --tag.");
    }
    if (args["no-plan"] && args.tag) {
      throw new Error("--no-plan cannot be combined with --tag.");
    }

    await setupGitHub({
      workspaceName: args["workspace-name"],
      workspaceRegion: args["workspace-region"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
      branch: args.branch,
      tag: args.tag,
      tagPattern: args["tag-pattern"] ?? "v*",
      environment: args.environment,
      plan: !args["no-plan"],
      dir: args.dir,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});
