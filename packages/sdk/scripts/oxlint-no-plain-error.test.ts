import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const oxlintBin = path.join(packageRoot, "node_modules/.bin/oxlint");
const pluginPath = path.join(packageRoot, "oxlint-plugins/index.js");

const fixture = [
  'import { CLIError, internalError } from "#/cli/shared/errors";',
  "export function userFailure(): never {",
  '  throw CLIError({ code: "EXAMPLE_FAILURE", message: "example" });',
  "}",
  "export function invariant(): never {",
  '  throw internalError("invariant violated");',
  "}",
  "export function plain(): never {",
  '  throw new Error("plain");',
  "}",
  'export const timeout = new Promise((_, reject) => reject(new Error("timeout")));',
  'export const generated = `throw new Error("inside generated code")`;',
  'export const called = Error("call");',
  "",
].join("\n");

type Diagnostic = { code: string; labels: { span: { line: number } }[] };

function lint(level: "error" | "off"): { rule: string; line: number }[] {
  const dir = mkdtempSync(path.join(tmpdir(), "no-plain-error-"));
  try {
    const config = path.join(dir, ".oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({
        plugins: [],
        jsPlugins: [pluginPath],
        rules: { "local/no-plain-error": level },
      }),
    );
    const file = path.join(dir, "command.ts");
    writeFileSync(file, fixture);
    const result = spawnSync(oxlintBin, ["--config", config, "-f", "json", file], {
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };
    return diagnostics.map((diagnostic) => ({
      rule: diagnostic.code,
      line: diagnostic.labels[0]?.span.line ?? 0,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("local/no-plain-error", () => {
  test("flags every Error construction outside generated-code strings", () => {
    expect(lint("error")).toEqual([
      { rule: "local(no-plain-error)", line: 9 },
      { rule: "local(no-plain-error)", line: 11 },
      { rule: "local(no-plain-error)", line: 13 },
    ]);
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
