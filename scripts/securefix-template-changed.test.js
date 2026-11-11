import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const MARK_STEP = "Mark pending template change";
const CHANGESET_STEP = "Create changeset file";
const EXISTING_CHANGESET_STEP = "Add the setup plugin to the existing changeset";
const TEMPLATES = "packages/sdk-plugin-setup/src/templates.ts";
const AUTOFIX_TEMPLATE = "packages/sdk-plugin-setup/src/autofix.workflow.yml";
const SETUP_PLUGIN = "@tailor-platform/sdk-plugin-setup";
const SANITIZER = ".github/scripts/neutralize-mentions.mjs";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);
const workflowLines = () =>
  readFileSync(repoFile(".github/workflows/securefix.yml"), "utf8").split("\n");

function stepLines(name) {
  const lines = workflowLines();
  const start = lines.indexOf(`      - name: ${name}`);
  if (start < 0) throw new Error(`step "${name}" not found in securefix.yml`);
  const end = lines.findIndex((line, i) => i > start && /^( {6}- name:|\S| {0,4}\S)/.test(line));
  return lines.slice(start, end < 0 ? undefined : end);
}

function stepScript(name) {
  const block = stepLines(name);
  const run = block.indexOf("        run: |");
  if (run < 0) throw new Error(`step "${name}" has no run block`);
  return block
    .slice(run + 1)
    .map((line) => line.slice(10))
    .join("\n");
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

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "securefix-template-"));
  roots.push(root);
  return root;
}

function templatesSource(flag) {
  return `const RELEASED_TEMPLATE_VERSION = 26;\nconst TEMPLATE_CHANGED_SINCE_RELEASE = ${flag};\n`;
}

// A pull request branch checked out from a clone of `main`, like the regenerate job's checkout.
function pullRequestBranch({
  flag = "false",
  templates,
  changed,
  baseAdvancesTemplate = false,
  baseFlag,
}) {
  const root = tempRoot();
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
  }
  if (baseFlag !== undefined) {
    write(origin, TEMPLATES, templatesSource(baseFlag));
  }
  if (baseAdvancesTemplate || baseFlag !== undefined) {
    git(origin, "add", "--all");
    git(origin, "commit", "--quiet", "-m", "base moves on");
  }
  return work;
}

function runStep(work) {
  const outputFile = join(work, "..", "github-output");
  writeFileSync(outputFile, "");
  const result = spawnSync("bash", ["-c", stepScript(MARK_STEP)], {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, BASE_REF: "main", GITHUB_OUTPUT: outputFile },
  });
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    changed: /^changed=(.*)$/m.exec(readFileSync(outputFile, "utf8"))?.[1],
  };
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

  test("reports a template change whether or not the flag was already set", () => {
    expect(runStep(pullRequestBranch({ changed: AUTOFIX_TEMPLATE })).changed).toBe("true");
    expect(runStep(pullRequestBranch({ flag: "true", changed: AUTOFIX_TEMPLATE })).changed).toBe(
      "true",
    );
  });

  test("reports no template change when only other files changed", () => {
    const work = pullRequestBranch({ changed: "packages/sdk-plugin-setup/src/other.ts" });
    expect(runStep(work).changed).toBe("false");
  });

  test("fails when the base released the pending flag after the branch was cut", () => {
    const work = pullRequestBranch({ flag: "true", changed: AUTOFIX_TEMPLATE, baseFlag: "false" });
    const result = runStep(work);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("behind");
  });

  test("passes when the base set the same flag after the branch was cut", () => {
    const work = pullRequestBranch({ flag: "false", changed: AUTOFIX_TEMPLATE, baseFlag: "true" });
    expect(runStep(work).status).toBe(0);
    expect(flagLine(work)).toBe("const TEMPLATE_CHANGED_SINCE_RELEASE = true;");
  });
});

function runChangesetStep({ names, templateChanged }) {
  const root = tempRoot();
  mkdirSync(join(root, ".changeset"));
  mkdirSync(join(root, ".github/scripts"), { recursive: true });
  copyFileSync(repoFile(SANITIZER), join(root, SANITIZER));
  const result = spawnSync("bash", ["-c", stepScript(CHANGESET_STEP)], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PR_TITLE: "chore(deps): update dependency example/action to v1.0.1",
      PR_NUMBER: "7",
      NAMES: names,
      TEMPLATE_CHANGED: templateChanged,
      BASE_REF: "main",
    },
  });
  if (result.status !== 0) throw new Error(result.stderr);
  const frontmatter = readFileSync(join(root, ".changeset/renovate-7.md"), "utf8")
    .split("---")[1]
    .trim();
  return frontmatter === "" ? [] : frontmatter.split("\n");
}

describe("securefix: changeset for a setup template change", { timeout: 60_000 }, () => {
  test("releases the setup plugin when only a template changed", () => {
    expect(runChangesetStep({ names: "", templateChanged: "true" })).toEqual([
      `"${SETUP_PLUGIN}": patch`,
    ]);
  });

  test("keeps the runtime dependency packages and adds the setup plugin", () => {
    const lines = runChangesetStep({ names: "@other/pkg", templateChanged: "true" });
    expect(lines).toEqual([`"@other/pkg": patch`, `"${SETUP_PLUGIN}": patch`]);
  });

  test("lists the setup plugin once when a runtime dependency change names it too", () => {
    const lines = runChangesetStep({ names: SETUP_PLUGIN, templateChanged: "true" });
    expect(lines).toEqual([`"${SETUP_PLUGIN}": patch`]);
  });

  test("does not add the setup plugin when no template changed", () => {
    expect(runChangesetStep({ names: "@other/pkg", templateChanged: "false" })).toEqual([
      `"@other/pkg": patch`,
    ]);
  });
});

function runExistingChangesetStep(content) {
  const root = tempRoot();
  mkdirSync(join(root, ".changeset"));
  const file = join(root, ".changeset/renovate-7.md");
  writeFileSync(file, content);
  const result = spawnSync("bash", ["-c", stepScript(EXISTING_CHANGESET_STEP)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PR_NUMBER: "7" },
  });
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    content: readFileSync(file, "utf8"),
  };
}

describe("securefix: setup plugin in a changeset that already exists", { timeout: 60_000 }, () => {
  const existing = '---\n"@other/pkg": patch\n---\n\nchore(deps): update dependency other\n';

  test("adds the setup plugin and keeps the rest of the changeset", () => {
    const result = runExistingChangesetStep(existing);
    expect(result.status).toBe(0);
    expect(result.content).toBe(
      `---\n"${SETUP_PLUGIN}": patch\n"@other/pkg": patch\n---\n\nchore(deps): update dependency other\n`,
    );
  });

  test("leaves a changeset that already lists the setup plugin untouched", () => {
    const listed = `---\n"${SETUP_PLUGIN}": minor\n---\n\nchore(deps): update\n`;
    const result = runExistingChangesetStep(listed);
    expect(result.status).toBe(0);
    expect(result.content).toBe(listed);
  });

  test("fails instead of silently doing nothing when the changeset has no front matter", () => {
    const result = runExistingChangesetStep("chore(deps): update\n");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(SETUP_PLUGIN);
  });
});

describe("securefix: template change reaches the changeset decision", () => {
  const output = (name) => stepLines(name).join("\n");

  test("an existing changeset is amended only for a template change", () => {
    expect(output(EXISTING_CHANGESET_STEP)).toContain(
      "steps.existing.outputs.found == 'true' && steps.template.outputs.changed == 'true'",
    );
  });

  test("the mark step exposes its result under the id the later steps read", () => {
    expect(output(MARK_STEP)).toContain("id: template");
  });

  test("creating a changeset also happens for a template-only change", () => {
    expect(output(CHANGESET_STEP)).toContain("steps.template.outputs.changed == 'true'");
    expect(output(CHANGESET_STEP)).toContain(
      "TEMPLATE_CHANGED: ${{ steps.template.outputs.changed }}",
    );
  });

  test("the skip-changeset label is not added for a template change", () => {
    const line = workflowLines().find((l) => l.startsWith("      skip-changeset:"));
    expect(line).toContain("steps.template.outputs.changed != 'true'");
  });
});
