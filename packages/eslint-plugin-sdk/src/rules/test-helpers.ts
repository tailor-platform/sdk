/* oxlint-disable vitest/expect-expect -- Assertions are centralized in shared lint helpers. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect } from "vitest";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginUrl = pathToFileURL(resolve(packageDir, "dist/index.js")).href;
const tempDirs: string[] = [];

// Invoke oxlint's JS bin script via `node` directly rather than the
// platform-specific `.bin/` shim, which is `.cmd`/`.ps1` on Windows.
const oxlintBinScript = resolve(
  dirname(fileURLToPath(import.meta.resolve("oxlint/package.json"))),
  "bin/oxlint",
);

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

export function lint(source: string, rule: string, filename = "fixture.ts") {
  const dir = mkdtempSync(join(tmpdir(), "tailor-sdk-lint-"));
  tempDirs.push(dir);
  const file = join(dir, filename);
  const config = join(dir, ".oxlintrc.json");

  writeFileSync(file, source);
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "tailor-sdk", specifier: pluginUrl }],
      rules: { [`tailor-sdk/${rule}`]: "error" },
    }),
  );

  const result = spawnSync(process.execPath, [oxlintBinScript, "--config", config, file], {
    cwd: dir,
    encoding: "utf8",
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

export function expectViolation(
  source: string,
  rule: string,
  message: string,
  filename?: string,
): void {
  const result = lint(source, rule, filename);
  expect({ status: result.status, output: result.output }).toMatchObject({ status: 1 });
  expect(result.output).toContain(`tailor-sdk(${rule})`);
  expect(result.output).toContain(message);
}

export function expectClean(source: string, rule: string, filename?: string): void {
  const result = lint(source, rule, filename);
  expect({ status: result.status, output: result.output }).toMatchObject({ status: 0 });
}
