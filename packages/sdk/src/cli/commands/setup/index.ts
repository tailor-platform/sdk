import { arg, defineCommand } from "politty";
import { z } from "zod";
import { confirmationArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { checkGitHub } from "./check";
import { setupDelete } from "./delete";
import { setupCoordinate, setupTarget } from "./generate";

const checkCommand = defineAppCommand({
  name: "check",
  description: "Audit generated workflows for drift against the current config/repo (read-only).",
  args: z.strictObject({
    ci: arg(z.boolean().default(false), {
      description:
        "Run in CI mode: skip checks that are handled by the runtime " +
        "(e.g. TAILOR_PLATFORM_WORKSPACE_ID).",
    }),
  }),
  run: async (args) => {
    await checkGitHub({ outputDir: process.cwd(), ci: args.ci });
  },
});

const coordinateCommand = defineAppCommand({
  name: "coordinate",
  description:
    "Generate a coordinator workflow that orchestrates multiple --action-generated composite actions.",
  args: z.strictObject({
    name: arg(z.string().min(1), {
      alias: "n",
      description: "Coordinator name (used in the generated workflow file name and job names)",
    }),
    action: arg(z.array(z.string().min(1)).min(1), {
      description:
        "Composite action to include (can be specified multiple times). tailor- prefix optional.",
    }),
    branch: arg(z.string().min(1).optional(), {
      description: "Branch target: deploy trigger branch (defaults to the detected default branch)",
    }),
    tag: arg(z.boolean().default(false), {
      description: "Generate a tag target coordinator",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the plan/deploy jobs",
    }),
    force: arg(z.boolean().default(false), {
      description: "Discard hand edits and regenerate",
    }),
  }),
  run: async (args) => {
    const coordinateKind = args.tag ? "tag" : "branch";
    await setupCoordinate({
      coordinatorName: args.name,
      coordinateKind,
      actions: args.action,
      branch: args.branch,
      environment: args.environment,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});

const actionCommand = defineAppCommand({
  name: "action",
  description:
    "Generate a per-app composite action for use with setup coordinate (monorepo multi-app deploys).",
  args: z.strictObject({
    name: arg(z.string().min(1).optional(), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    dir: arg(z.string().min(1).default("."), {
      alias: "d",
      description: "App directory",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment (defaults to the workspace name)",
    }),
    force: arg(z.boolean().default(false), {
      description: "Discard hand edits and regenerate",
    }),
  }),
  run: async (args) => {
    await setupTarget({
      kind: "action",
      workspaceName: args.name,
      dir: args.dir,
      environment: args.environment,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});

const branchCommand = defineAppCommand({
  name: "branch",
  description: "Generate a branch-target deploy workflow (push to branch triggers deploy).",
  args: z.strictObject({
    name: arg(z.string().min(1).optional(), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    branch: arg(z.string().min(1).optional(), {
      description: "Deploy trigger branch (defaults to the detected default branch)",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the plan/deploy jobs (defaults to the workspace name)",
    }),
    "erd-preview": arg(z.boolean().default(false), {
      description: "Add PR ERD viewer artifacts with current/diff previews for TailorDB namespaces",
    }),
    dir: arg(z.string().min(1).default("."), {
      alias: "d",
      description: "App directory (for monorepo setups)",
    }),
    force: arg(z.boolean().default(false), {
      description: "Discard hand edits / take over unmanaged files and regenerate",
    }),
  }),
  run: async (args) => {
    await setupTarget({
      kind: "branch",
      workspaceName: args.name,
      branch: args.branch,
      environment: args.environment,
      erdPreview: args["erd-preview"],
      dir: args.dir,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});

const tagCommand = defineAppCommand({
  name: "tag",
  description: "Generate a tag-target deploy workflow (tag push triggers deploy).",
  args: z.strictObject({
    name: arg(z.string().min(1).optional(), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    "tag-pattern": arg(z.string().min(1).default("v*"), {
      description: "Tag glob to match (defaults to v*)",
    }),
    branch: arg(z.string().min(1).optional(), {
      description: "Tag-reachability guard branch (no guard when omitted)",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the plan/deploy jobs (defaults to the workspace name)",
    }),
    dir: arg(z.string().min(1).default("."), {
      alias: "d",
      description: "App directory (for monorepo setups)",
    }),
    force: arg(z.boolean().default(false), {
      description: "Discard hand edits / take over unmanaged files and regenerate",
    }),
  }),
  run: async (args) => {
    await setupTarget({
      kind: "tag",
      workspaceName: args.name,
      tagPattern: args["tag-pattern"],
      branch: args.branch,
      environment: args.environment,
      dir: args.dir,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});

const previewCommand = defineAppCommand({
  name: "preview",
  description: "Generate a preview workflow (PR open/sync triggers deploy to a per-PR workspace).",
  args: z.strictObject({
    name: arg(z.string().min(1).optional(), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    branch: arg(z.string().min(1).optional(), {
      description: "Branch to filter PRs by (defaults to the detected default branch)",
    }),
    region: arg(z.string().min(1), {
      description: "Workspace region for preview workspace creation (e.g. us-west). Required.",
    }),
    "require-preview-label": arg(z.boolean().default(false), {
      description: "Deploy preview only for PRs labeled `tailor:preview` instead of all PRs.",
    }),
    environment: arg(z.string().min(1).optional(), {
      description: "GitHub Environment for the preview jobs (defaults to the workspace name)",
    }),
    dir: arg(z.string().min(1).default("."), {
      alias: "d",
      description: "App directory (for monorepo setups)",
    }),
    force: arg(z.boolean().default(false), {
      description: "Discard hand edits / take over unmanaged files and regenerate",
    }),
  }),
  run: async (args) => {
    await setupTarget({
      kind: "preview",
      workspaceName: args.name,
      branch: args.branch,
      region: args.region,
      requirePreviewLabel: args["require-preview-label"],
      environment: args.environment,
      dir: args.dir,
      force: args.force,
      outputDir: process.cwd(),
    });
  },
});

const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete managed workflow/action file(s) and their .github/tailor.lock entries.",
  args: z.strictObject({
    ...confirmationArgs,
    files: arg(z.string().array().min(1), {
      positional: true,
      description:
        "Workflow/action file(s) to delete, as generated under .github/workflows or .github/actions",
    }),
  }),
  run: async (args) => {
    await setupDelete({ files: args.files, yes: args.yes, outputDir: process.cwd() });
  },
});

export const setupCommand = defineCommand({
  name: "setup",
  description: "Generate CI deploy workflows for your project. (beta)",
  subCommands: {
    branch: branchCommand,
    tag: tagCommand,
    preview: previewCommand,
    action: actionCommand,
    coordinate: coordinateCommand,
    check: checkCommand,
    delete: deleteCommand,
  },
});
