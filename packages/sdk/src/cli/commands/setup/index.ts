import { arg, defineCommand } from "@politty/valibot";
import * as v from "valibot";
import { confirmationArgs } from "#/cli/shared/args";
import { defineAppCommand } from "#/cli/shared/command";
import { checkGitHub } from "./check";
import { setupDelete } from "./delete";
import { setupCoordinate, setupTarget } from "./generate";
import { setupRenovate } from "./renovate";

const checkCommand = defineAppCommand({
  name: "check",
  description: "Audit generated workflows for drift against the current config/repo (read-only).",
  args: v.strictObject({
    ci: arg(v.optional(v.boolean(), false), {
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
  args: v.strictObject({
    name: arg(v.pipe(v.string(), v.minLength(1)), {
      alias: "n",
      description: "Coordinator name (used in the generated workflow file name and job names)",
    }),
    action: arg(v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1)), {
      description:
        "Composite action to include. Repeat for separate deploy steps, or use commas to deploy actions as one multi-config group. tailor- prefix optional.",
    }),
    branch: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "Branch target: deploy trigger branch (defaults to the detected default branch)",
    }),
    tag: arg(v.optional(v.boolean(), false), {
      description: "Generate a tag target coordinator",
    }),
    environment: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "GitHub Environment for the plan/deploy jobs",
    }),
    force: arg(v.optional(v.boolean(), false), {
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
  args: v.strictObject({
    name: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    dir: arg(v.optional(v.pipe(v.string(), v.minLength(1)), "."), {
      alias: "d",
      description: "App directory",
    }),
    environment: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "GitHub Environment (defaults to the workspace name)",
    }),
    force: arg(v.optional(v.boolean(), false), {
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
  args: v.strictObject({
    name: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    branch: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "Deploy trigger branch (defaults to the detected default branch)",
    }),
    environment: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "GitHub Environment for the plan/deploy jobs (defaults to the workspace name)",
    }),
    "erd-preview": arg(v.optional(v.boolean(), false), {
      description: "Add PR ERD viewer artifacts with current/diff previews for TailorDB namespaces",
    }),
    dir: arg(v.optional(v.pipe(v.string(), v.minLength(1)), "."), {
      alias: "d",
      description: "App directory (for monorepo setups)",
    }),
    force: arg(v.optional(v.boolean(), false), {
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
  args: v.strictObject({
    name: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    "tag-pattern": arg(v.optional(v.pipe(v.string(), v.minLength(1)), "v*"), {
      description: "Tag glob to match (defaults to v*)",
    }),
    branch: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "Tag-reachability guard branch (no guard when omitted)",
    }),
    environment: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "GitHub Environment for the plan/deploy jobs (defaults to the workspace name)",
    }),
    dir: arg(v.optional(v.pipe(v.string(), v.minLength(1)), "."), {
      alias: "d",
      description: "App directory (for monorepo setups)",
    }),
    force: arg(v.optional(v.boolean(), false), {
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
  args: v.strictObject({
    name: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      alias: "n",
      description: "Name (defaults to the config 'name')",
    }),
    branch: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "Branch to filter PRs by (defaults to the detected default branch)",
    }),
    region: arg(v.pipe(v.string(), v.minLength(1)), {
      description: "Workspace region for preview workspace creation (e.g. us-west). Required.",
    }),
    "require-preview-label": arg(v.optional(v.boolean(), false), {
      description: "Deploy preview only for PRs labeled `tailor:preview` instead of all PRs.",
    }),
    environment: arg(v.optional(v.pipe(v.string(), v.minLength(1))), {
      description: "GitHub Environment for the preview jobs (defaults to the workspace name)",
    }),
    dir: arg(v.optional(v.pipe(v.string(), v.minLength(1)), "."), {
      alias: "d",
      description: "App directory (for monorepo setups)",
    }),
    force: arg(v.optional(v.boolean(), false), {
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

const renovateCommand = defineAppCommand({
  name: "renovate",
  description: "Generate a Renovate config for Tailor dependency and workflow updates.",
  args: v.strictObject({}),
  run: async () => {
    await setupRenovate({ outputDir: process.cwd() });
  },
});

const deleteCommand = defineAppCommand({
  name: "delete",
  description: "Delete managed workflow/action file(s) and their .github/tailor.lock entries.",
  args: v.strictObject({
    ...confirmationArgs,
    files: arg(v.pipe(v.array(v.string()), v.minLength(1)), {
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
  description: "Set up repository automation for your project. (beta)",
  subCommands: {
    branch: branchCommand,
    tag: tagCommand,
    preview: previewCommand,
    action: actionCommand,
    coordinate: coordinateCommand,
    renovate: renovateCommand,
    check: checkCommand,
    delete: deleteCommand,
  },
});
