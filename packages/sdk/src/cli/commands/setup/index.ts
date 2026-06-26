import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { checkGitHub } from "./check";
import { setupGitHub } from "./generate";

const checkCommand = defineAppCommand({
  name: "check",
  description: "Audit generated workflows for drift against the current config/repo (read-only).",
  args: z.object({}).strict(),
  run: async () => {
    await checkGitHub({ outputDir: process.cwd() });
  },
});

export const setupCommand = defineAppCommand({
  name: "setup",
  description: "Generate a CI deploy workflow for your project. (beta)",
  args: z
    .object({
      provider: arg(
        z
          .enum(["github"], { message: "Only the 'github' provider is supported." })
          .default("github"),
        {
          alias: "p",
          description: "CI provider to generate for (only 'github' is supported)",
        },
      ),
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
      "erd-preview": arg(z.boolean().default(false), {
        description: "Add PR ERD viewer and diff preview artifacts for TailorDB namespaces",
      }),
      dir: arg(z.string().min(1).default("."), {
        alias: "d",
        description: "App directory (for monorepo setups)",
      }),
      force: arg(z.boolean().default(false), {
        description: "Discard hand edits / take over unmanaged files and regenerate",
      }),
    })
    .strict(),
  subCommands: {
    check: checkCommand,
  },
  run: async (args) => {
    if (args["tag-pattern"] !== undefined && !args.tag) {
      throw new Error("--tag-pattern requires --tag.");
    }
    if (args["no-plan"] && args.tag) {
      throw new Error("--no-plan cannot be combined with --tag.");
    }

    // `provider` is validated by the enum to the only value supported today;
    // a second provider would branch here to its own generator.
    await setupGitHub({
      workspaceName: args["workspace-name"],
      branch: args.branch,
      tag: args.tag,
      tagPattern: args["tag-pattern"] ?? "v*",
      environment: args.environment,
      plan: !args["no-plan"],
      erdPreview: args["erd-preview"],
      dir: args.dir,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});
