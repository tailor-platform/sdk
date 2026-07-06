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

const templateFiles: [output: string, commands: string[]][] = [
  ["application", ["init", "generate", "deploy", "remove", "show", "open", "api"]],
  ["tailordb", ["tailordb"]],
  ["query", ["query"]],
  ["user", ["login", "logout", "auth", "user"]],
  ["organization", ["organization"]],
  ["workspace", ["workspace", "profile"]],
  ["auth", ["authconnection", "machineuser", "oauth2client"]],
  ["workflow", ["workflow"]],
  ["function", ["function"]],
  ["executor", ["executor"]],
  ["secret", ["secret"]],
  ["staticwebsite", ["staticwebsite"]],
  ["crashreport", ["crashreport"]],
  ["setup", ["setup"]],
  ["upgrade", ["upgrade"]],
  ["skills", ["skills"]],
  ["plugin", ["plugin"]],
  ["completion", ["completion"]],
];

const targetCommands = templateFiles.flatMap(([, commands]) => commands);

const templates = {
  ...Object.fromEntries(
    templateFiles.map(([name]) => [`docs/cli/${name}.md`, `docs/cli/${name}.template.md`]),
  ),
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
      // strip unknown keys
      globalArgs: z.object(commonArgs),
      formatter: mdFormatter,
    });
  });
});
