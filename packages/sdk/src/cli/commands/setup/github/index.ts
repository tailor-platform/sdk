import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { setupGitHub } from "./github";

export const githubCommand = defineAppCommand({
  name: "github",
  description: "Generate GitHub Actions workflow for deployment.",
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
  run: async (args) => {
    await setupGitHub({
      workspaceName: args["workspace-name"],
      workspaceRegion: args["workspace-region"],
      organizationId: args["organization-id"],
      folderId: args["folder-id"],
      dir: args.dir,
      outputDir: process.cwd(),
    });
  },
});
