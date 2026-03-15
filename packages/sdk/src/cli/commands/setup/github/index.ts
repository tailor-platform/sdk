import { arg, defineCommand } from "politty";
import { z } from "zod";
import { commonArgs, withCommonArgs } from "@/cli/shared/args";
import { setupGitHub } from "./github";

export const githubCommand = defineCommand({
  name: "github",
  description: "Generate GitHub Actions workflow for deployment.",
  args: z
    .object({
      ...commonArgs,
      "workspace-name": arg(z.string(), {
        alias: "n",
        description: "Workspace name",
      }),
      "workspace-region": arg(z.string(), {
        alias: "r",
        description: "Workspace region",
      }),
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
    })
    .strict(),
  run: withCommonArgs(async (args) => {
    await setupGitHub({
      workspaceName: args["workspace-name"],
      workspaceRegion: args["workspace-region"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
      dir: args.dir,
      outputDir: process.cwd(),
    });
  }),
});
