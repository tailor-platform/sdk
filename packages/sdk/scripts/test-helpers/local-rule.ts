import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "../..");
const oxlintBin = path.join(packageRoot, "node_modules/.bin/oxlint");
const pluginPath = path.join(packageRoot, "oxlint-plugins/index.js");

type Diagnostic = { code: string; labels: { span: { line: number } }[] };

type LintWithLocalRuleParams = {
  /** Rule name without the `local/` prefix. */
  rule: string;
  level: "error" | "off";
  /** Name of the linted file, which decides how oxlint parses it. */
  fileName: string;
  source: string;
};

/**
 * Lint a source with one rule of the local oxlint plugin and no other rule.
 * @param params - The rule, its level, and the file to lint
 * @returns The rule and line of each diagnostic
 */
export function lintWithLocalRule(
  params: LintWithLocalRuleParams,
): { rule: string; line: number }[] {
  const { rule, level, fileName, source } = params;
  const dir = mkdtempSync(path.join(tmpdir(), `${rule}-`));
  try {
    const config = path.join(dir, ".oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({ plugins: [], jsPlugins: [pluginPath], rules: { [`local/${rule}`]: level } }),
    );
    const file = path.join(dir, fileName);
    writeFileSync(file, source);
    const result = spawnSync(oxlintBin, ["--config", config, "-f", "json", file], {
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };
    return diagnostics.map((diagnostic) => ({
      rule: diagnostic.code,
      line: diagnostic.labels[0]?.span.line ?? 0,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
