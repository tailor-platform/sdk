import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { setupGitHub } from "./github";

export const githubCommand = defineAppCommand({
  name: "github",
  description: "Generate GitHub Actions workflow for deployment. (beta)",
  args: z
    .object({
      "workspace-name": arg(z.string(), {
        alias: "n",
        description: "Workspace name",
      }),
      "workspace-region": arg(z.string(), {
        alias: "r",
        description: "Workspace region",
      }),
      // Required here because the generated workflow uses these for workspace creation.
      // Could be made optional in the future if we add conditional template rendering.
      "organization-id": arg(z.string(), {
        alias: "o",
        description: "Organization ID",
      }),
      "folder-id": arg(z.string(), {
        alias: "f",
        description: "Folder ID",
      }),
      dir: arg(z.string().default("."), {
        alias: "d",
        description: "App directory (for monorepo setups)",
      }),
      "with-plan": arg(z.boolean().default(false), {
        alias: "p",
        description: "Include plan job for PR previews",
      }),
    })
    .strict(),
  run: (args) => {
    setupGitHub({
      workspaceName: args["workspace-name"],
      workspaceRegion: args["workspace-region"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
      dir: args.dir,
      outputDir: process.cwd(),
      withPlan: args["with-plan"],
    });
  },
});
