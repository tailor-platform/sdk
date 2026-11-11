import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const STEP_NAME = "Mark pending template change";
const TEMPLATES = "packages/sdk-plugin-setup/src/templates.ts";
const AUTOFIX_TEMPLATE = "packages/sdk-plugin-setup/src/autofix.workflow.yml";

function stepScript() {
  const lines = readFileSync(
    new URL("../.github/workflows/securefix.yml", import.meta.url),
    "utf8",
  ).split("\n");
  const start = lines.indexOf(`      - name: ${STEP_NAME}`);
  if (start < 0) throw new Error(`step "${STEP_NAME}" not found in securefix.yml`);
  const run = lines.indexOf("        run: |", start);
  if (run < 0) throw new Error(`step "${STEP_NAME}" has no run block`);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function write(root, path, content) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function templatesSource(flag) {
  return `const RELEASED_TEMPLATE_VERSION = 26;\nconst TEMPLATE_CHANGED_SINCE_RELEASE = ${flag};\n`;
}

// A pull request branch checked out from a clone of `main`, like the regenerate job's checkout.
function pullRequestBranch({ flag = "false", templates, changed, baseAdvancesTemplate = false }) {
  const root = mkdtempSync(join(tmpdir(), "securefix-template-"));
  roots.push(root);
  const origin = join(root, "origin");
  const work = join(root, "work");
  mkdirSync(origin);
  git(origin, "init", "--quiet", "-b", "main");
  write(origin, TEMPLATES, templates ?? templatesSource(flag));
  write(origin, AUTOFIX_TEMPLATE, "uses: owner/action@aaaa # v1.0.0\n");
  write(origin, "packages/sdk-plugin-setup/src/other.ts", "export {};\n");
  git(origin, "add", "--all");
  git(origin, "commit", "--quiet", "-m", "base");
  git(root, "clone", "--quiet", origin, work);
  git(work, "checkout", "--quiet", "-b", "renovate/bump");
  write(
    work,
    changed,
    changed.endsWith(".yml") ? "uses: owner/action@bbbb # v1.0.1\n" : "export const a = 1;\n",
  );
  git(work, "add", "--all");
  git(work, "commit", "--quiet", "-m", "bump");
  if (baseAdvancesTemplate) {
    write(origin, AUTOFIX_TEMPLATE, "uses: owner/action@cccc # v1.0.2\n");
    git(origin, "add", "--all");
    git(origin, "commit", "--quiet", "-m", "base moves on");
  }
  return work;
}

function runStep(work) {
  const result = spawnSync("bash", ["-c", stepScript()], {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, BASE_REF: "main" },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

const flagLine = (work) =>
  readFileSync(join(work, TEMPLATES), "utf8")
    .split("\n")
    .find((line) => line.startsWith("const TEMPLATE_CHANGED_SINCE_RELEASE"));

describe("securefix: mark pending template change", { timeout: 60_000 }, () => {
  test("sets the flag when a Renovate pull request changes a setup workflow template", () => {
    const work = pullRequestBranch({ changed: AUTOFIX_TEMPLATE });
    expect(runStep(work).status).toBe(0);
    expect(flagLine(work)).toBe("const TEMPLATE_CHANGED_SINCE_RELEASE = true;");
  });

  test("keeps the flag when it is already set", () => {
    const work = pullRequestBranch({ flag: "true", changed: AUTOFIX_TEMPLATE });
    expect(runStep(work).status).toBe(0);
    expect(flagLine(work)).toBe("const TEMPLATE_CHANGED_SINCE_RELEASE = true;");
  });

  test("leaves the flag alone when no setup workflow template changed", () => {
    const work = pullRequestBranch({ changed: "packages/sdk-plugin-setup/src/other.ts" });
    expect(runStep(work).status).toBe(0);
    expect(flagLine(work)).toBe("const TEMPLATE_CHANGED_SINCE_RELEASE = false;");
  });

  test("ignores a template change that reached the base after the branch was cut", () => {
    const work = pullRequestBranch({
      changed: "packages/sdk-plugin-setup/src/other.ts",
      baseAdvancesTemplate: true,
    });
    expect(runStep(work).status).toBe(0);
    expect(flagLine(work)).toBe("const TEMPLATE_CHANGED_SINCE_RELEASE = false;");
  });

  test("fails instead of silently doing nothing when the flag line is gone", () => {
    const work = pullRequestBranch({
      templates: "const RELEASED_TEMPLATE_VERSION = 26;\n",
      changed: AUTOFIX_TEMPLATE,
    });
    const result = runStep(work);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("TEMPLATE_CHANGED_SINCE_RELEASE");
  });
});
