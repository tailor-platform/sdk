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
    tpl: "docs/cli/application.md.tpl",
  },
  "docs/cli/tailordb.md": {
    commands: ["tailordb"],
    tpl: "docs/cli/tailordb.md.tpl",
  },
  "docs/cli/query.md": {
    commands: ["query"],
    tpl: "docs/cli/query.md.tpl",
  },
  "docs/cli/user.md": {
    commands: ["login", "logout", "user"],
    tpl: "docs/cli/user.md.tpl",
  },
  "docs/cli/organization.md": {
    commands: ["organization"],
    tpl: "docs/cli/organization.md.tpl",
  },
  "docs/cli/workspace.md": {
    commands: ["workspace", "profile"],
    tpl: "docs/cli/workspace.md.tpl",
  },
  "docs/cli/auth.md": {
    commands: ["authconnection", "machineuser", "oauth2client"],
    tpl: "docs/cli/auth.md.tpl",
  },
  "docs/cli/workflow.md": {
    commands: ["workflow"],
    tpl: "docs/cli/workflow.md.tpl",
  },
  "docs/cli/function.md": {
    commands: ["function"],
    tpl: "docs/cli/function.md.tpl",
  },
  "docs/cli/executor.md": {
    commands: ["executor"],
    tpl: "docs/cli/executor.md.tpl",
  },
  "docs/cli/secret.md": {
    commands: ["secret"],
    tpl: "docs/cli/secret.md.tpl",
  },
  "docs/cli/staticwebsite.md": {
    commands: ["staticwebsite"],
    tpl: "docs/cli/staticwebsite.md.tpl",
  },
  "docs/cli/crashreport.md": {
    commands: ["crashreport"],
    tpl: "docs/cli/crashreport.md.tpl",
  },
  "docs/cli/setup.md": {
    commands: ["setup"],
    tpl: "docs/cli/setup.md.tpl",
  },
  "docs/cli/upgrade.md": {
    commands: ["upgrade"],
    tpl: "docs/cli/upgrade.md.tpl",
  },
  "docs/cli/skills.md": {
    commands: ["skills"],
    tpl: "docs/cli/skills.md.tpl",
  },
  "docs/cli/completion.md": {
    commands: ["completion"],
    tpl: "docs/cli/completion.md.tpl",
  },
};

const targetCommands = Object.values(templateFiles).flatMap((c) => c.commands);

const templates = {
  ...Object.fromEntries(Object.entries(templateFiles).map(([output, { tpl }]) => [output, tpl])),
  "docs/cli-reference.md": "docs/cli-reference.md.tpl",
};

describe("CLI Documentation", () => {
  test("output files contain no politty markers", () => {
    const applicationDoc = readFileSync(
      new URL("../../docs/cli/application.md", import.meta.url),
      "utf-8",
    );

    expect(applicationDoc).not.toContain("<!-- politty:");
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
