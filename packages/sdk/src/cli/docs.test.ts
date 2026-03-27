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
  "docs/cli/executor.md": {
    commands: ["executor"],
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
  "docs/cli/setup.md": {
    commands: ["setup"],
    render: defaultRender,
  },
  "docs/cli/completion.md": {
    commands: ["completion"],
    render: defaultRender,
  },
  "docs/cli/function.md": {
    commands: ["function"],
    render: defaultRender,
  },
  "docs/cli/crash-report.md": {
    commands: ["crash-report"],
    render: defaultRender,
  },
  "docs/cli/organization.md": {
    commands: ["organization"],
    render: defaultRender,
  },
  "docs/cli/upgrade.md": {
    commands: ["upgrade"],
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
