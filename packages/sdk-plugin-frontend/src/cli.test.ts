import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";

const cliEntry = fileURLToPath(new URL("../../sdk/bin/tailor.mjs", import.meta.url));
const frontendEntry = new URL("../dist/index.js", import.meta.url).href;
const sdkEntry = new URL("../../sdk/dist/configure/index.mjs", import.meta.url).href;

function duplicateConfig() {
  const dir = mkdtempSync(join(tmpdir(), "frontend-duplicate-"));
  writeFileSync(
    join(dir, "tailor.config.ts"),
    `import { defineStaticWebSite } from ${JSON.stringify(sdkEntry)};
import { frontendPlugin } from ${JSON.stringify(frontendEntry)};
export default { name: "app" };
export const plugins = [frontendPlugin(
  { site: "web", distDir: "web" },
  { site: "admin", distDir: "admin" },
  { site: defineStaticWebSite("web", {}), distDir: "web-copy" },
  { site: "admin", distDir: "admin-copy" },
  { site: "web", distDir: "web-third" },
)];
`,
  );
  return { dir, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

function runGenerate(cwd: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [cliEntry, "generate", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      PATH: process.env.PATH,
      NO_COLOR: "1",
      POLITTY_NO_AGENT: "1",
      TAILOR_CRASH_REPORTS_LOCAL: "off",
      TAILOR_CRASH_REPORTS_REMOTE: "off",
    },
  });

  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  return result.stderr;
}

describe("frontend config errors through the CLI", () => {
  beforeAll(() => {
    for (const entry of [
      frontendEntry,
      sdkEntry,
      new URL("../../sdk/dist/cli/main.mjs", import.meta.url),
    ]) {
      if (!existsSync(new URL(entry))) {
        throw new Error(
          `Missing build output: ${fileURLToPath(entry)}. Run \`pnpm build\` from the repository root first.`,
        );
      }
    }
  });

  test("preserves duplicate diagnostics in JSON output", () => {
    using fixture = duplicateConfig();

    expect(JSON.parse(runGenerate(fixture.dir, ["--json"]))).toEqual({
      error: {
        code: "FRONTEND_SITE_DUPLICATE",
        message:
          'tailor.config.ts: Duplicate frontend site "web" at argument indices: 0, 2, 4\nDuplicate frontend site "admin" at argument indices: 1, 3',
        suggestion: "Configure each site only once in frontendPlugin().",
        context: {
          pluginId: "@tailor-platform/frontend",
          duplicates: [
            { name: "web", indices: [0, 2, 4] },
            { name: "admin", indices: [1, 3] },
          ],
        },
      },
    });
  });

  test("preserves duplicate diagnostics in plain output", () => {
    using fixture = duplicateConfig();

    const stderr = runGenerate(fixture.dir);

    expect(stderr).toContain(
      'Error [FRONTEND_SITE_DUPLICATE]: tailor.config.ts: Duplicate frontend site "web" at argument indices: 0, 2, 4',
    );
    expect(stderr).toContain('Duplicate frontend site "admin" at argument indices: 1, 3');
    expect(stderr).toContain("Suggestion: Configure each site only once in frontendPlugin().");
  });
});
