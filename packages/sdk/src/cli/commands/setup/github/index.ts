import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { checkGitHub } from "./check";
import { setupGitHub } from "./github";

export const githubCommand = defineAppCommand({
  name: "github",
  description: "Generate a GitHub Actions deploy workflow. (beta)",
  args: z
    .object({
      "workspace-name": arg(z.string().min(1).optional(), {
        alias: "n",
        description: "Workspace name (defaults to the config 'name')",
      }),
      branch: arg(z.string().min(1).optional(), {
        description:
          "Branch target: deploy trigger branch (defaults to the detected default branch). " +
          "Tag target: tag-reachability guard branch (no guard when omitted)",
      }),
      tag: arg(z.boolean().default(false), {
        description: "Generate a tag target (deploy on tag push)",
      }),
      "tag-pattern": arg(z.string().min(1).optional(), {
        description: "Tag glob to match (requires --tag; defaults to v*)",
      }),
      environment: arg(z.string().min(1).optional(), {
        description: "GitHub Environment for the plan/deploy jobs (defaults to the workspace name)",
      }),
      "no-plan": arg(z.boolean().default(false), {
        description: "Disable the plan job for a branch target (cannot be combined with --tag)",
      }),
      dir: arg(z.string().min(1).default("."), {
        alias: "d",
        description: "App directory (for monorepo setups)",
      }),
      force: arg(z.boolean().default(false), {
        description: "Discard hand edits / take over unmanaged files and regenerate",
      }),
      check: arg(z.boolean().default(false), {
        description:
          "Audit generated workflows for drift against the current config/repo (read-only)",
      }),
    })
    .strict(),
  run: async (args) => {
    if (args.check) {
      const genOnlyFlags = [
        args.force && "--force",
        args.tag && "--tag",
        args["tag-pattern"] !== undefined && "--tag-pattern",
        args.branch !== undefined && "--branch",
        args["no-plan"] && "--no-plan",
        args.dir !== "." && "--dir",
        args["workspace-name"] !== undefined && "--workspace-name",
        args.environment !== undefined && "--environment",
      ].filter(Boolean) as string[];
      if (genOnlyFlags.length > 0) {
        throw new Error(
          `--check is read-only and cannot be combined with generation flags: ${genOnlyFlags.join(", ")}.`,
        );
      }
      checkGitHub({ outputDir: process.cwd() });
      return;
    }

    if (args["tag-pattern"] !== undefined && !args.tag) {
      throw new Error("--tag-pattern requires --tag.");
    }
    if (args["no-plan"] && args.tag) {
      throw new Error("--no-plan cannot be combined with --tag.");
    }

    await setupGitHub({
      workspaceName: args["workspace-name"],
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
