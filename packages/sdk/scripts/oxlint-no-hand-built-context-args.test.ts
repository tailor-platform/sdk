import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

const fixture = [
  'export const profileArgs = ["login", "--profile", profile];',
  "export const workspaceArg = `--workspace-id=${workspaceId}`;",
  'export const ifExists = ["--env-file-if-exists", file];',
  'export const envFile = "--env-file=.env";',
  "export const prose = `Then run:\\n  tailor login --profile ${profile}`;",
  "export const fixedTemplate = `--env-file=.env.local`;",
  'export const parsed = token === "--workspace-id";',
  "export const configArg = `--config=${config}`;",
  'export const other = "--profiles";',
  "export const mention = `Pick one with --profile.`;",
  "export const after = `${workspaceId} --profile`;",
  "export const limit = 2;",
  "",
].join("\n");

function lint(level: "error" | "off") {
  return lintWithLocalRule({
    rule: "no-hand-built-context-args",
    level,
    fileName: "command.ts",
    source: fixture,
  });
}

describe("local/no-hand-built-context-args", () => {
  test("flags each context flag a string or template writes, once per literal", () => {
    expect(lint("error")).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((line) => ({
        rule: "local(no-hand-built-context-args)",
        line,
      })),
    );
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
