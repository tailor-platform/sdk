import { execSync } from "node:child_process";
import { assertDocMatch, createCommandRenderer } from "politty/docs";
import { describe, it, vi } from "vitest";
import { commonArgs } from "./args";
import { mainCommand } from "./index";
import type { FileConfig, OptionsRenderContext } from "politty/docs";

/**
 * Format markdown content using oxfmt
 * @param content - Markdown content to format
 * @returns Formatted markdown content
 */
function mdFormatter(content: string): string {
  return execSync("pnpm oxfmt --stdin-filepath=file.md", {
    input: content,
    encoding: "utf-8",
  });
}

vi.mock("node:module", async () => {
  const actual = await vi.importActual("node:module");
  return { ...actual, register: vi.fn() };
});

vi.mock("politty", async () => {
  const actual = await vi.importActual("politty");
  return { ...actual, runMain: vi.fn() };
});

// Options to exclude from documentation (auto-generated from commonArgs)
const excludedOptions = new Set(Object.keys(commonArgs));

/**
 * Custom options renderer that filters out commonArgs
 * @param context - Options render context from politty
 * @returns Rendered options markdown without commonArgs
 */
function renderOptionsWithoutCommonArgs(context: OptionsRenderContext): string {
  const filteredOptions = context.options.filter((opt) => !excludedOptions.has(opt.name));
  if (filteredOptions.length === 0) {
    return "";
  }
  return context.render(filteredOptions);
}

/**
 * Create a command renderer that excludes commonArgs from options
 * @param headingLevel - Heading level for the command documentation
 * @returns Command renderer function
 */
function createRenderer(headingLevel: 1 | 2 | 3 | 4 | 5 | 6) {
  return createCommandRenderer({
    headingLevel,
    renderOptions: renderOptionsWithoutCommonArgs,
  });
}

const defaultRender = createRenderer(1);

// File configurations - subcommands are auto-expanded from parent command names
const files: Record<string, FileConfig> = {
  "docs/cli/application.md": {
    commands: ["init", "generate", "apply", "remove", "show", "open", "api"],
    render: defaultRender,
  },
  "docs/cli/tailordb.md": {
    commands: ["tailordb"],
    render: defaultRender,
  },
  "docs/cli/user.md": {
    commands: ["login", "logout", "user"],
    render: defaultRender,
  },
  "docs/cli/workspace.md": {
    commands: ["workspace", "profile"],
    render: defaultRender,
  },
  "docs/cli/auth.md": {
    commands: ["machineuser", "oauth2client"],
    render: defaultRender,
  },
  "docs/cli/workflow.md": {
    commands: ["workflow"],
    render: defaultRender,
  },
  "docs/cli/secret.md": {
    commands: ["secret"],
    render: defaultRender,
  },
  "docs/cli/staticwebsite.md": {
    commands: ["staticwebsite"],
    render: defaultRender,
  },
};

// Auto-generate targetCommands from files
const targetCommands = Object.values(files).flatMap((config) => config.commands);

describe("CLI Documentation", () => {
  it("matches golden files", { timeout: 60000 }, async () => {
    await assertDocMatch({
      command: mainCommand,
      files,
      targetCommands,
      formatter: mdFormatter,
    });
  });
});
