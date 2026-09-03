import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkDir = resolve(repoRoot, "packages/sdk");
const sdkConfig = resolve(sdkDir, ".oxlintrc.json");
const requireFromSdk = createRequire(resolve(sdkDir, "package.json"));
const oxlintBinScript = resolve(
  dirname(requireFromSdk.resolve("oxlint/package.json")),
  "bin/oxlint",
);
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readConfig(configPath) {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function runNoDeprecatedLint(fixture, tsconfig, disabled = false) {
  const args = [
    oxlintBinScript,
    "--type-aware",
    "--config",
    sdkConfig,
    "--tsconfig",
    tsconfig,
    "--no-ignore",
    "--format",
    "json",
  ];
  if (disabled) args.push("-A", "typescript/no-deprecated");
  args.push(fixture);

  const result = spawnSync(process.execPath, args, { cwd: sdkDir, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, report: JSON.parse(result.stdout), stderr: result.stderr };
}

describe("typescript/no-deprecated configuration", () => {
  test("is enabled by every type-aware configuration owner", () => {
    const templatesDir = resolve(repoRoot, "packages/create-sdk/templates");
    const templateConfigs = readdirSync(templatesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => resolve(templatesDir, entry.name, ".oxlintrc.json"));
    expect(templateConfigs.length).toBeGreaterThan(0);

    const configPaths = [resolve(repoRoot, "oxlint.shared.json"), sdkConfig, ...templateConfigs];
    for (const configPath of configPaths) {
      expect({
        config: relative(repoRoot, configPath),
        severity: readConfig(configPath).rules?.["typescript/no-deprecated"],
      }).toEqual({ config: relative(repoRoot, configPath), severity: "error" });
    }
  });

  test("reports a deprecated TypeScript reference", () => {
    const dir = mkdtempSync(join(tmpdir(), "oxlint-no-deprecated-"));
    tempDirs.push(dir);
    const fixture = resolve(dir, "fixture.ts");
    const tsconfig = resolve(dir, "tsconfig.json");
    writeFileSync(
      fixture,
      "/** @deprecated Use currentValue instead. */\ndeclare const legacyValue: number;\nvoid legacyValue;\n",
    );
    writeFileSync(
      tsconfig,
      JSON.stringify({ compilerOptions: { strict: true }, files: ["fixture.ts"] }),
    );

    const cleanControl = runNoDeprecatedLint(fixture, tsconfig, true);
    expect(cleanControl).toMatchObject({ status: 0, report: { diagnostics: [] }, stderr: "" });

    const violation = runNoDeprecatedLint(fixture, tsconfig);
    expect(violation.status).toBe(1);
    expect(violation.stderr).toBe("");
    expect(violation.report.diagnostics).toHaveLength(1);
    expect(violation.report.diagnostics[0]).toMatchObject({ code: "typescript(no-deprecated)" });
  });
});
