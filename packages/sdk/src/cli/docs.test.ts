import { readFileSync } from "node:fs";
import { format } from "oxfmt";
import { assertDocMatch } from "politty/docs";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { commonArgs } from "./shared/args";
import { mainCommand } from "./index";

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

const templateFiles: Record<string, { commands: string[]; tpl: string }> = {
  "docs/cli/application.md": {
    commands: ["init", "generate", "deploy", "remove", "show", "open", "api"],
    tpl: "docs/cli/application.template.md",
  },
  "docs/cli/tailordb.md": {
    commands: ["tailordb"],
    tpl: "docs/cli/tailordb.template.md",
  },
  "docs/cli/query.md": {
    commands: ["query"],
    tpl: "docs/cli/query.template.md",
  },
  "docs/cli/user.md": {
    commands: ["login", "logout", "user"],
    tpl: "docs/cli/user.template.md",
  },
  "docs/cli/organization.md": {
    commands: ["organization"],
    tpl: "docs/cli/organization.template.md",
  },
  "docs/cli/workspace.md": {
    commands: ["workspace", "profile"],
    tpl: "docs/cli/workspace.template.md",
  },
  "docs/cli/auth.md": {
    commands: ["authconnection", "machineuser", "oauth2client"],
    tpl: "docs/cli/auth.template.md",
  },
  "docs/cli/workflow.md": {
    commands: ["workflow"],
    tpl: "docs/cli/workflow.template.md",
  },
  "docs/cli/function.md": {
    commands: ["function"],
    tpl: "docs/cli/function.template.md",
  },
  "docs/cli/executor.md": {
    commands: ["executor"],
    tpl: "docs/cli/executor.template.md",
  },
  "docs/cli/secret.md": {
    commands: ["secret"],
    tpl: "docs/cli/secret.template.md",
  },
  "docs/cli/staticwebsite.md": {
    commands: ["staticwebsite"],
    tpl: "docs/cli/staticwebsite.template.md",
  },
  "docs/cli/crashreport.md": {
    commands: ["crashreport"],
    tpl: "docs/cli/crashreport.template.md",
  },
  "docs/cli/setup.md": {
    commands: ["setup"],
    tpl: "docs/cli/setup.template.md",
  },
  "docs/cli/upgrade.md": {
    commands: ["upgrade"],
    tpl: "docs/cli/upgrade.template.md",
  },
  "docs/cli/skills.md": {
    commands: ["skills"],
    tpl: "docs/cli/skills.template.md",
  },
  "docs/cli/completion.md": {
    commands: ["completion"],
    tpl: "docs/cli/completion.template.md",
  },
};

const targetCommands = Object.values(templateFiles).flatMap((c) => c.commands);

const templates = {
  ...Object.fromEntries(Object.entries(templateFiles).map(([output, { tpl }]) => [output, tpl])),
  "docs/cli-reference.md": "docs/cli-reference.template.md",
};

describe("CLI Documentation", () => {
  test("output files contain no politty markers", () => {
    for (const outputPath of Object.keys(templates)) {
      const content = readFileSync(new URL(`../../${outputPath}`, import.meta.url), "utf-8");
      expect(content, `${outputPath} should not contain politty markers`).not.toContain(
        "<!-- politty:",
      );
    }
  });

  test("matches golden files", { timeout: 60000 }, async () => {
    await assertDocMatch({
      command: mainCommand,
      templates,
      targetCommands,
      globalArgs: z.object(commonArgs),
      formatter: mdFormatter,
    });
  });
});
