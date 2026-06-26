import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { logger } from "#/cli/shared/logger";
import { checkGitHub } from "./check";
import { setupGitHub } from "./generate";

const checkCommand = defineAppCommand({
  name: "check",
  description: "Audit generated workflows for drift against the current config/repo (read-only).",
  args: z
    .object({
      ci: arg(z.boolean().default(false), {
        description:
          "Run in CI mode: skip checks that are handled by the runtime " +
          "(e.g. TAILOR_PLATFORM_WORKSPACE_ID).",
      }),
    })
    .strict(),
  run: (args) => {
    checkGitHub({ outputDir: process.cwd(), ci: args.ci });
  },
});

const coordinateCommand = defineAppCommand({
  name: "coordinate",
  description:
    "Generate a coordinator workflow that orchestrates multiple --action-generated composite actions.",
  args: z
    .object({
      "workspace-name": arg(z.string().min(1), {
        alias: "n",
        description: "Coordinator name (used in the generated workflow file name and job names)",
      }),
      action: arg(z.array(z.string()).default([]), {
        description:
          "Composite action to include (can be specified multiple times). tailor- prefix optional.",
      }),
      branch: arg(z.string().min(1).optional(), {
        description:
          "Branch target: deploy trigger branch (defaults to the detected default branch)",
      }),
      tag: arg(z.boolean().default(false), {
        description: "Generate a tag target coordinator",
      }),
      preview: arg(z.boolean().default(false), {
        description: "Generate a preview coordinator",
      }),
      environment: arg(z.string().min(1).optional(), {
        description: "GitHub Environment for the plan/deploy jobs",
      }),
      force: arg(z.boolean().default(false), {
        description: "Discard hand edits and regenerate",
      }),
    })
    .strict(),
  run: async (_args) => {
    // TODO: implement coordinate generation
    logger.warn("setup coordinate is not yet implemented");
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
      dir: arg(z.string().min(1).default("."), {
        alias: "d",
        description: "App directory (for monorepo setups)",
      }),
      action: arg(z.string().min(1).optional(), {
        description:
          "Generate a per-app composite action instead of a full workflow. " +
          "The action is written to .github/actions/tailor-<name>/action.yml.",
      }),
      preview: arg(z.boolean().default(false), {
        description: "Generate a preview workflow (PR label-triggered deploy to per-PR workspace).",
      }),
      force: arg(z.boolean().default(false), {
        description: "Discard hand edits / take over unmanaged files and regenerate",
      }),
    })
    .strict(),
  subCommands: {
    check: checkCommand,
    coordinate: coordinateCommand,
  },
  run: async (args) => {
    if (args["tag-pattern"] !== undefined && !args.tag) {
      throw new Error("--tag-pattern requires --tag.");
    }
    if (args["no-plan"] && args.tag) {
      throw new Error("--no-plan cannot be combined with --tag.");
    }
    if (args.action !== undefined && args.tag) {
      throw new Error(
        "--action cannot be combined with --tag (use setup coordinate for multi-app tag deploys).",
      );
    }
    if (args.preview && args.tag) {
      throw new Error("--preview cannot be combined with --tag.");
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
      dir: args.dir,
      action: args.action,
      preview: args.preview,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});
