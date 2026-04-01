import { readFileSync } from "node:fs";
import { format } from "oxfmt";
import { assertDocMatch, createCommandRenderer } from "politty/docs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { commonArgs } from "./shared/args";
import { mainCommand } from "./index";
import type { FileConfig } from "politty/docs";

/**
 * Format markdown content using oxfmt JS API
 * @param content - Markdown content to format
 * @returns Formatted markdown content
 */
async function mdFormatter(content: string): Promise<string> {
  const result = await format("file.md", content);
  return result.code;
}

vi.mock("node:module", async () => {
  const actual = await vi.importActual("node:module");
  return { ...actual, register: vi.fn() };
});

vi.mock("politty", async () => {
  const actual = await vi.importActual("politty");
  return { ...actual, runMain: vi.fn() };
});

const defaultRender = createCommandRenderer({ headingLevel: 1 });

// File configurations - subcommands are auto-expanded from parent command names
// Order matches the manually maintained section order on main
const files: Record<string, FileConfig> = {
  "docs/cli/application.md": {
    title: "Application Commands",
    description:
      "Commands for managing Tailor Platform applications (work with `tailor.config.ts`).",
    commands: ["init", "generate", "apply", "remove", "show", "open", "api"],
    render: defaultRender,
  },
  "docs/cli/tailordb.md": {
    title: "TailorDB Commands",
    description: "Commands for managing TailorDB tables, data, and schema migrations.",
    commands: ["tailordb"],
    render: defaultRender,
  },
  "docs/cli/user.md": {
    title: "User & Auth Commands",
    description: "Commands for authentication and user management.",
    commands: ["login", "logout", "user"],
    render: defaultRender,
  },
  "docs/cli/organization.md": {
    title: "Organization Commands",
    description: "Commands for managing organizations and folders.",
    commands: ["organization"],
    render: defaultRender,
  },
  "docs/cli/workspace.md": {
    title: "Workspace Commands",
    description: "Commands for managing workspaces and profiles.",
    commands: ["workspace", "profile"],
    render: defaultRender,
  },
  "docs/cli/auth.md": {
    title: "Auth Resource Commands",
    description: "Commands for managing Auth service resources.",
    commands: ["authconnection", "machineuser", "oauth2client"],
    render: defaultRender,
  },
  "docs/cli/workflow.md": {
    title: "Workflow Commands",
    description: "Commands for managing workflows and executions.",
    commands: ["workflow"],
    render: defaultRender,
  },
  "docs/cli/function.md": {
    title: "Function Commands",
    description: "Commands for viewing function execution logs.",
    commands: ["function"],
    render: defaultRender,
  },
  "docs/cli/executor.md": {
    title: "Executor Commands",
    description: "Commands for managing executors and executor jobs.",
    commands: ["executor"],
    render: defaultRender,
  },
  "docs/cli/secret.md": {
    title: "Secret Commands",
    description: "Commands for managing secrets and vaults.",
    commands: ["secret"],
    render: defaultRender,
  },
  "docs/cli/staticwebsite.md": {
    title: "Static Website Commands",
    description: "Commands for managing and deploying static websites.",
    commands: ["staticwebsite"],
    render: defaultRender,
  },
  "docs/cli/crash-report.md": {
    title: "Crash Report Commands",
    description: "Commands for managing crash reports.",
    commands: ["crash-report"],
    render: defaultRender,
  },
  "docs/cli/setup.md": {
    title: "Setup Commands",
    description: "Commands for setting up project infrastructure.",
    commands: ["setup"],
    render: defaultRender,
  },
  "docs/cli/completion.md": {
    title: "Completion",
    description: "Generate shell completion scripts for bash, zsh, and fish.",
    commands: ["completion"],
    render: defaultRender,
  },
};

// Auto-generate targetCommands from files
const targetCommands = Object.values(files).flatMap((config) => config.commands);

describe("CLI Documentation", () => {
  it("uses section-level command markers", () => {
    const applicationDoc = readFileSync(
      new URL("../../docs/cli/application.md", import.meta.url),
      "utf-8",
    );

    expect(applicationDoc).toContain("<!-- politty:command:init:heading:start -->");
    expect(applicationDoc).toContain("<!-- politty:command:init:usage:start -->");
    expect(applicationDoc).not.toContain("<!-- politty:command:init:start -->");
  });

  it("matches golden files", { timeout: 60000 }, async () => {
    await assertDocMatch({
      command: mainCommand,
      files,
      targetCommands,
      globalArgs: z.object(commonArgs),
      rootDoc: { path: "docs/cli-reference.md" },
      formatter: mdFormatter,
    });
  });
});
