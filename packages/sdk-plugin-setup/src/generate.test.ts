import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as vm from "node:vm";
import { logger } from "@tailor-platform/sdk/cli";
import { parseYAML } from "confbox";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import {
  decideAction,
  detectPackageManager,
  LOCKFILES,
  printTargetNextSteps,
  setupTarget,
  type BranchSetupOptions,
  type SetupTargetOptions,
} from "./generate";
import { detectDefaultBranch } from "./git";
import { hashContent, LOCK_VERSION, readLock, writeLock } from "./lock";
import { computeManagedHash, isManagedHash } from "./managed";
import {
  ACTIONS_SHA,
  ACTIONS_VERSION,
  TEMPLATE_VERSION,
  renderBranchWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  type RenderBranchParams,
  type RenderTagParams,
} from "./templates";
import { tempDir } from "./test-helpers/temp-dir";

const NO_MARKER = /__[A-Z_]+__/;
const BRANCH_TEMPLATE = fs.readFileSync(
  path.join(import.meta.dirname, "branch.workflow.yml"),
  "utf8",
);
// Renovate changes this pin in the template, so tests derive the expected value from there.
const [, UPLOAD_ARTIFACT_GITHUB_COM, UPLOAD_ARTIFACT_GITHUB_COM_VERSION] =
  /uses: (actions\/upload-artifact@[0-9a-f]{40}) # (v\S+)/.exec(BRANCH_TEMPLATE) ?? [];
const UPLOAD_ARTIFACT_V3 = "actions/upload-artifact@c6a366c94c3e0affe28c06c8df20a878f24da3cf";

const branchBase: RenderBranchParams = {
  workspaceName: "my-app",
  branch: "main",
  environment: "my-app",
  packageManager: "pnpm",
  erdPreview: null,
};

const tagBase: RenderTagParams = {
  workspaceName: "my-app",
  tagPattern: "v*",
  environment: "my-app",
  packageManager: "pnpm",
};

type GeneratedWorkflow = {
  jobs: Record<string, { if?: string; steps: Array<Record<string, unknown>> }>;
};

describe("detectPackageManager", () => {
  const testDir = path.join(
    "/tmp",
    `detect-pm-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  aroundEach(async (runTest) => {
    fs.mkdirSync(testDir, { recursive: true });
    await runTest();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  const writeManifest = (manifest: unknown): void => {
    fs.writeFileSync(path.join(testDir, "package.json"), JSON.stringify(manifest));
  };

  test.each(LOCKFILES)("detects %s from %s", (lockfile, expected) => {
    fs.writeFileSync(path.join(testDir, lockfile), "");
    expect(detectPackageManager(testDir)).toBe(expected);
  });

  test.each([
    [{ packageManager: "pnpm@10.12.1+sha512.abc" }, "pnpm"],
    [{ packageManager: "yarn@4.9.2" }, "yarn"],
    [{ devEngines: { packageManager: { name: "bun", version: "1.2.0" } } }, "bun"],
    [
      {
        packageManager: "npm@11.0.0",
        devEngines: { packageManager: { name: "npm", version: "^11" } },
      },
      "npm",
    ],
    [{ packageManager: "", devEngines: { packageManager: { name: "pnpm" } } }, "pnpm"],
    [{ packageManager: "yarn@4.9.2", devEngines: { packageManager: { name: "" } } }, "yarn"],
    [{ devEngines: { packageManager: [{ name: "pnpm" }] } }, "pnpm"],
    [{ devEngines: { packageManager: [{ name: "cnpm" }, { name: "yarn" }] } }, "yarn"],
    [{ devEngines: { packageManager: [null, "npm", {}, { name: "bun" }] } }, "bun"],
    [
      {
        packageManager: "pnpm@10.12.1",
        devEngines: { packageManager: [{ name: "npm" }, { name: "pnpm" }] },
      },
      "pnpm",
    ],
    [{ packageManager: "yarn@4.9.2", devEngines: { packageManager: [] } }, "yarn"],
  ] as const)("detects the package manager %j declares", (manifest, expected) => {
    writeManifest(manifest);
    expect(detectPackageManager(testDir)).toBe(expected);
  });

  test("prefers the root lockfile over package.json", () => {
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    writeManifest({ packageManager: "yarn@4.9.2" });
    expect(detectPackageManager(testDir)).toBe("pnpm");
  });

  test("rejects package.json fields that name different package managers", () => {
    writeManifest({
      packageManager: "pnpm@10.12.1",
      devEngines: { packageManager: { name: "yarn", version: "4.9.2" } },
    });
    expect(() => detectPackageManager(testDir)).toThrow(
      /package\.json at the repository root declares pnpm in packageManager but yarn in devEngines\.packageManager/,
    );
  });

  test("rejects a packageManager field missing from a devEngines.packageManager array", () => {
    writeManifest({
      packageManager: "pnpm@10.12.1",
      devEngines: { packageManager: [{ name: "npm" }, { name: "yarn" }] },
    });
    expect(() => detectPackageManager(testDir)).toThrow(
      /declares pnpm in packageManager but npm or yarn in devEngines\.packageManager/,
    );
  });

  test("rejects a root package.json that is not valid JSON", () => {
    fs.writeFileSync(path.join(testDir, "package.json"), "{");
    expect(() => detectPackageManager(testDir)).toThrow(
      /package\.json at the repository root is not valid JSON/,
    );
  });

  test.each([
    ["no lockfile or package.json", undefined],
    ["a package.json without a package manager", { private: true }],
    ["an unsupported package manager", { packageManager: "cnpm@9.0.0" }],
    ["an empty devEngines.packageManager array", { devEngines: { packageManager: [] } }],
  ])("detects nothing from %s", (_label, manifest) => {
    if (manifest !== undefined) writeManifest(manifest);
    expect(detectPackageManager(testDir)).toBeUndefined();
  });
});

describe("renderBranchWorkflow", () => {
  test("leaves no markers and parses as YAML", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).not.toMatch(NO_MARKER);
    expect(() => parseYAML(content)).not.toThrow();
  });

  test("emits the managed header and workspace-scoped name", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content.startsWith("# Generated by")).toBe(true);
    expect(content).toContain("name: Tailor (my-app)");
  });

  test("pins actions with SHA + version comment, including the tailor actions", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).toMatch(/uses: actions\/checkout@[a-f0-9]+ # v\d+\.\d+\.\d+/);
    // tailor-platform actions use a branch/tag comment (e.g. "# v1.5.0"), not semver
    expect(content).toMatch(/uses: tailor-platform\/actions\/setup@[0-9a-f]{40} # \S+/);
    expect(content).toMatch(/uses: tailor-platform\/actions\/generate-check@[0-9a-f]{40} # \S+/);
    expect(content).toMatch(/uses: tailor-platform\/actions\/plan@[0-9a-f]{40} # \S+/);
    expect(content).toMatch(/uses: tailor-platform\/actions\/deploy@[0-9a-f]{40} # \S+/);
  });

  test("pins every `uses:` to a full commit SHA (no moving tags/branches)", () => {
    // Generated workflows are committed to user repos and must be reproducible
    // and pass zizmor/ghalint pinning checks: every action reference must be a
    // 40-char commit SHA, never a tag like @v1.
    const assertShaPinned = (content: string): void => {
      const refs = [...content.matchAll(/uses:\s*(\S+?)@(\S+)/g)];
      expect(refs.length).toBeGreaterThan(0);
      for (const [, action, ref] of refs) {
        expect(ref, `${action}@${ref} must be pinned to a 40-char commit SHA`).toMatch(
          /^[0-9a-f]{40}$/,
        );
      }
    };
    for (const pm of ["pnpm", "yarn", "npm", "bun"] as const) {
      assertShaPinned(renderBranchWorkflow({ ...branchBase, packageManager: pm }).content);
      assertShaPinned(renderTagWorkflow({ ...tagBase, packageManager: pm }).content);
    }
  });

  test("uses the unified secret names and targets the workspace-id variable", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).toContain(
      "platform-client-id: ${{ vars.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID || secrets.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID }}",
    );
    expect(content).toContain(
      "platform-client-secret: ${{ secrets.TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET }}",
    );
    expect(content).toContain("workspace-id: ${{ vars.TAILOR_PLATFORM_WORKSPACE_ID }}");
    expect(content).not.toContain("secrets.PLATFORM_MACHINE_USER_CLIENT_ID");
  });

  test("targets the workspace by id, never by region or folder", () => {
    const { content } = renderBranchWorkflow(branchBase);
    // workspace-name is used by tailor-notify as a display label — that is intentional.
    // The workspace-id variable is how plan/deploy actually target the workspace.
    expect(content).not.toContain("workspace-region:");
    expect(content).not.toContain("organization-id:");
    expect(content).not.toContain("folder-id:");
  });

  test("sets environment on both the plan and deploy jobs", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, environment: "production" });
    expect(content.match(/environment: production/g)).toHaveLength(2);
  });

  test("passes the workspace name as the plan label", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).toContain("label: my-app");
  });

  test("references the dry-run dispatch input with bracket notation", () => {
    // `inputs.dry-run` is ambiguous to readers/tools; the bracket form is
    // unambiguous for a hyphenated input name.
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).toContain("inputs['dry-run']");
    expect(content).not.toMatch(/inputs\.dry-run/);
  });

  test("includes the fork guard on the plan step", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).toContain(
      "if: github.event_name != 'pull_request' || !github.event.pull_request.head.repo.fork",
    );
  });

  test("sets cancel-in-progress: false on the deploy concurrency group", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).toContain("group: tailor-deploy-my-app");
    expect(content).toContain("cancel-in-progress: false");
  });

  test("includes generate + generate-check in plan only (deploy delegates)", () => {
    const { content } = renderBranchWorkflow(branchBase);
    const parsed = parseYAML(content) as { jobs: Record<string, unknown> };
    expect(Object.keys(parsed.jobs)).toEqual(["tailor-plan", "tailor-deploy", "tailor-result"]);
    expect(content.match(/id: tailor-generate-check/g)).toHaveLength(1);
  });

  test("omits ERD preview jobs by default", () => {
    const { content, generatedIds } = renderBranchWorkflow(branchBase);
    const parsed = parseYAML(content) as { jobs: Record<string, unknown> };
    expect(Object.keys(parsed.jobs)).toEqual(["tailor-plan", "tailor-deploy", "tailor-result"]);
    expect(content).not.toContain("tailor-erd-preview");
    expect(generatedIds).not.toContain("tailor-erd-preview");
  });

  test("installs head dependencies in the ERD preview job, since the setup action does not", () => {
    const { content, generatedIds } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb"] },
    });
    const steps = (parseYAML(content) as GeneratedWorkflow).jobs["tailor-erd-preview"]?.steps ?? [];
    const ids = steps.map((step) => step.id);

    expect(ids.indexOf("tailor-install")).toBe(ids.indexOf("tailor-setup") + 1);
    expect(String(steps[ids.indexOf("tailor-install")]?.uses)).toMatch(
      /^tailor-platform\/actions\/install@/,
    );
    expect(generatedIds).toContain("tailor-erd-preview/tailor-install");
  });

  test("adds ERD preview and comment jobs when enabled", () => {
    const { content, generatedIds } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb", "analyticsdb"] },
    });
    const parsed = parseYAML(content) as { jobs: Record<string, unknown> };

    expect(Object.keys(parsed.jobs)).toEqual([
      "tailor-plan",
      "tailor-erd-preview-matrix",
      "tailor-erd-preview",
      "tailor-erd-preview-comment",
      "tailor-deploy",
      "tailor-result",
    ]);
    expect(content).toContain(
      "namespace: ${{ fromJSON(needs.tailor-erd-preview-matrix.outputs.namespaces) }}",
    );
    expect(content).toContain(".tailor-erd-base/.github/tailor.lock");
    expect(content).toContain("run_tailor_cli tailordb erd export");
    expect(content).toContain('run_head_tailor_cli_bin "$GITHUB_WORKSPACE" tailordb erd diff');
    expect(content).toContain("const namespacePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;");
    expect(content).toContain("Invalid ERD namespace in");
    expect(content).toContain("id: tailor-detect-base-package-manager");
    expect(content).toContain("id: tailor-setup-base-pnpm");
    expect(content).toContain("id: tailor-setup-base-node");
    expect(content).toContain("id: tailor-setup-base-yarn");
    expect(content).toContain("id: tailor-setup-base-bun");
    expect(content).toContain("id: tailor-install-base");
    expect(content).toContain("id: tailor-restore-head-setup");
    expect(content).toContain("node-version-file: .tailor-erd-base/package.json");
    expect(content).toContain("working-directory: .tailor-erd-base");
    expect(content).toContain('base_package_manager="$(');
    expect(content).toContain("package-lock.json");
    expect(content).toContain('echo "package-manager=$base_package_manager" >> "$GITHUB_OUTPUT"');
    expect(content).not.toContain('case "$base_package_manager" in');
    expect(content).toContain(
      'base_config="$GITHUB_WORKSPACE/.tailor-erd-base/$BASE_APP_DIR/tailor.config.ts"',
    );
    expect(content).toContain("BASE_PACKAGE_MANAGER:");
    expect(content).toContain("tailor_cli_bin");
    expect(content).toContain("run_head_node - <<'NODE'");
    expect(content).toContain('path.join(githubWorkspace, appDir, "package.json")');
    expect(content).toContain('path.join(githubWorkspace, "package.json")');
    expect(content).toContain(
      'run_base_tailor_cli_bin "$GITHUB_WORKSPACE/.tailor-erd-base/$BASE_APP_DIR" tailordb erd export --config "$base_config"',
    );
    expect(content).toContain('yarn) run_head_cli_env yarn node "$head_cli_runner" "$@" ;;');
    expect(content).toContain('head_missing="false"');
    expect(content).toContain("grep -q 'not found in local config.db'");
    expect(content).toContain('diff_args=(--namespace "$NAMESPACE" --output "$preview_html")');
    expect(content).toContain("name: ${{ matrix.namespace }}-viewer.html");
    expect(content).not.toContain("name: ${{ matrix.namespace }}-diff.html");
    expect(content).toContain("HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(content).toContain('current_head=$(gh api "repos/$REPO/pulls/$PR_NUMBER"');
    expect(content).toContain("archive: false");
    expect(content).toContain('select(.name | endswith("-viewer.html"))');
    expect(content).not.toContain('endswith("-diff.html")');
    expect(content).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(generatedIds).toEqual(
      expect.arrayContaining([
        "tailor-erd-preview-matrix",
        "tailor-erd-preview-matrix/tailor-checkout",
        "tailor-erd-preview-matrix/tailor-checkout-base",
        "tailor-erd-preview-matrix/tailor-erd-preview-matrix",
        "tailor-erd-preview",
        "tailor-erd-preview/tailor-checkout",
        "tailor-erd-preview/tailor-checkout-base",
        "tailor-erd-preview/tailor-detect-base-package-manager",
        "tailor-erd-preview/tailor-setup-base-pnpm",
        "tailor-erd-preview/tailor-setup-base-node",
        "tailor-erd-preview/tailor-setup-base-yarn",
        "tailor-erd-preview/tailor-setup-base-bun",
        "tailor-erd-preview/tailor-install-base",
        "tailor-erd-preview/tailor-restore-head-setup",
        "tailor-erd-preview/tailor-build-erd-preview",
        "tailor-erd-preview/tailor-upload-erd-viewer",
        "tailor-erd-preview-comment",
        "tailor-erd-preview-comment/tailor-comment-erd-preview",
      ]),
    );
  });

  test("installs ERD base dependencies without the head checkout cache path", () => {
    const { content } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb"] },
    });
    const start = content.indexOf("id: tailor-detect-base-package-manager");
    const end = content.indexOf("id: tailor-restore-head-setup");
    const baseSetup = content.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(baseSetup).not.toContain("tailor-platform/actions/setup@");
    expect(baseSetup).not.toContain("cache:");
    expect(baseSetup).toContain("pnpm/action-setup@");
    expect(baseSetup).toContain("package_json_file: .tailor-erd-base/package.json");
    expect(baseSetup).toContain(
      "version: ${{ steps.tailor-detect-base-package-manager.outputs['pnpm-version'] }}",
    );
    expect(baseSetup).toContain('fallback = "10";');
    expect(baseSetup).not.toContain('readManifest("../package.json")');
    expect(baseSetup).toContain('echo "pnpm-version=$base_pnpm_version" >> "$GITHUB_OUTPUT"');
    expect(baseSetup).toContain("actions/setup-node@");
    expect(baseSetup).toContain("id: tailor-setup-base-yarn");
    expect(baseSetup).toContain("corepack enable");
    expect(baseSetup).toContain("oven-sh/setup-bun@");
    expect(baseSetup).toContain("pnpm install --frozen-lockfile");
    expect(baseSetup).toContain("npm ci");
    expect(baseSetup).toContain("grep -q '^__metadata:' yarn.lock");
    expect(baseSetup).toContain("yarn install --immutable");
    expect(baseSetup).toContain("yarn install --frozen-lockfile");
    expect(baseSetup).toContain("bun install --frozen-lockfile");
  });

  test("restores the head setup after installing ERD base dependencies", () => {
    const { content } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb"] },
    });
    const installBase = content.indexOf("id: tailor-install-base");
    const restoreHead = content.indexOf("id: tailor-restore-head-setup");
    const buildPreview = content.indexOf("id: tailor-build-erd-preview");
    const restoreStep = content.slice(restoreHead, buildPreview);

    expect(installBase).toBeGreaterThanOrEqual(0);
    expect(restoreHead).toBeGreaterThan(installBase);
    expect(buildPreview).toBeGreaterThan(restoreHead);
    expect(restoreStep).toContain("uses: tailor-platform/actions/setup@");
    expect(restoreStep).toContain("package-manager: pnpm");
  });

  test("runs ERD base export through the base package loader and head SDK bin", () => {
    const { content } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb"] },
    });
    const start = content.indexOf("id: tailor-build-erd-preview");
    const end = content.indexOf("id: tailor-upload-erd-viewer");
    const buildStep = content.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(buildStep).toContain("run_head_tailor_cli_bin() {");
    expect(buildStep).toContain("run_base_tailor_cli_bin() {");
    expect(buildStep).toContain('cd "$GITHUB_WORKSPACE"');
    expect(buildStep).toContain('local command_cwd="$1"');
    expect(buildStep).toContain("process.chdir(commandCwd);");
    expect(buildStep).toContain('case "pnpm" in');
    expect(buildStep).toContain('pnpm) run_head_cli_env pnpm exec node "$head_cli_runner" "$@" ;;');
    expect(buildStep).toContain('npm) run_head_cli_env node "$head_cli_runner" "$@" ;;');
    expect(buildStep).toContain('yarn) run_head_cli_env yarn node "$head_cli_runner" "$@" ;;');
    expect(buildStep).toContain('bun) run_head_cli_env bun "$head_cli_runner" "$@" ;;');
    expect(buildStep).toContain('case "$BASE_PACKAGE_MANAGER" in');
    expect(buildStep).toContain('cd "$command_cwd"');
    expect(buildStep).toContain(
      'run_base_tailor_cli_bin "$GITHUB_WORKSPACE/.tailor-erd-base/$BASE_APP_DIR" tailordb erd export --config "$base_config"',
    );
  });

  test("uses the base setup app directory for ERD base export", () => {
    const { content } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb"] },
    });
    const start = content.indexOf("id: tailor-build-erd-preview");
    const end = content.indexOf("id: tailor-upload-erd-viewer");
    const buildStep = content.slice(start, end);

    expect(content).toContain(
      "base-app-dirs: ${{ steps.tailor-erd-preview-matrix.outputs['base-app-dirs'] }}",
    );
    expect(content).toContain(
      "BASE_APP_DIR: ${{ fromJSON(needs.tailor-erd-preview-matrix.outputs['base-app-dirs'])[matrix.namespace] }}",
    );
    expect(buildStep).toContain(
      'base_config="$GITHUB_WORKSPACE/.tailor-erd-base/$BASE_APP_DIR/tailor.config.ts"',
    );
    expect(buildStep).toContain(
      'run_base_tailor_cli_bin "$GITHUB_WORKSPACE/.tailor-erd-base/$BASE_APP_DIR" tailordb erd export --config "$base_config"',
    );
    expect(buildStep).not.toContain(".tailor-erd-base/$APP_DIR/tailor.config.ts");
    expect(buildStep).not.toContain('.tailor-erd-base/$APP_DIR" tailordb erd export');
  });

  test("does not enter the head app directory before missing-head handling", () => {
    const { content } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb"] },
    });
    const start = content.indexOf("id: tailor-build-erd-preview");
    const end = content.indexOf("id: tailor-upload-erd-viewer");
    const buildStep = content.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const beforeHeadConfig = buildStep.slice(
      0,
      buildStep.indexOf('head_config="$GITHUB_WORKSPACE'),
    );
    expect(beforeHeadConfig).not.toContain('cd "$GITHUB_WORKSPACE/$APP_DIR"');
    expect(buildStep.match(/cd "\$GITHUB_WORKSPACE\/\$APP_DIR" \|\| exit 1/g)).toHaveLength(1);
    expect(buildStep).not.toContain('cd "$GITHUB_WORKSPACE/$APP_DIR"\n            run_head_node');
    expect(buildStep).not.toContain(
      'cd "$GITHUB_WORKSPACE/$APP_DIR"\n              case "__PACKAGE_MANAGER__"',
    );
    expect(buildStep).not.toContain(
      'cd "$GITHUB_WORKSPACE/$APP_DIR"\n            TAILOR_PLATFORM_SDK_DTS_PATH',
    );
    expect(buildStep).not.toContain(
      'cd "$GITHUB_WORKSPACE/$APP_DIR"\n            run_tailor_cli tailordb erd diff',
    );
    expect(buildStep).toContain('run_head_tailor_cli_bin "$GITHUB_WORKSPACE" tailordb erd diff');
  });

  test("treats missing ERD preview configs as empty diff sides", () => {
    const { content } = renderBranchWorkflow({
      ...branchBase,
      erdPreview: { namespaces: ["tailordb"] },
    });
    const start = content.indexOf("id: tailor-build-erd-preview");
    const end = content.indexOf("id: tailor-upload-erd-viewer");
    const buildStep = content.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(buildStep).toContain('if [ ! -f "$head_config" ]; then');
    expect(buildStep).toContain("Head ERD config not found; rendering base objects as removed.");
    expect(buildStep).toContain('if [ ! -f "$base_config" ]; then');
    expect(buildStep).toContain("Base ERD config not found; rendering current objects as added.");
  });

  test("passes the package manager to the setup action", () => {
    expect(renderBranchWorkflow(branchBase).content).toContain("package-manager: pnpm");
    expect(renderBranchWorkflow({ ...branchBase, packageManager: "npm" }).content).toContain(
      "package-manager: npm",
    );
    expect(renderBranchWorkflow({ ...branchBase, packageManager: "bun" }).content).toContain(
      "package-manager: bun",
    );
    expect(renderBranchWorkflow({ ...branchBase, packageManager: "yarn" }).content).toContain(
      "package-manager: yarn",
    );
  });

  test("calls the generate-check composite action instead of inlining the diff check", () => {
    const { content } = renderBranchWorkflow(branchBase);
    expect(content).toContain("uses: tailor-platform/actions/generate-check@");
    expect(content).not.toContain("git add -A");
    expect(content).not.toContain("tailor generate");
  });

  test("includes change detection + working-directory only when dir != '.'", () => {
    const plain = renderBranchWorkflow(branchBase).content;
    expect(plain).not.toContain("path-patterns:");
    expect(plain).not.toContain("working-directory:");

    const scoped = renderBranchWorkflow({ ...branchBase, workingDirectory: "apps/foo" }).content;
    expect(scoped).not.toMatch(NO_MARKER);
    expect(scoped).toContain("path-patterns: |\n            apps/foo/**\n");
    // Install, drift-check, and notify run at the repo root — no working-directory.
    // plan job: generate-check + plan; deploy job: deploy action.
    expect(scoped.match(/working-directory: apps\/foo/g)).toHaveLength(3);
    expect(() => parseYAML(scoped)).not.toThrow();
  });

  test("defaults the environment to the passed environment value", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, environment: "staging" });
    expect(content).not.toMatch(NO_MARKER);
    expect(content).toContain("environment: staging");
  });

  test.each(["pnpm", "yarn", "npm", "bun"] as const)(
    "delegates setup to the composite action and passes packageManager=%s",
    (pm) => {
      const { content } = renderBranchWorkflow({ ...branchBase, packageManager: pm });
      expect(content).toContain("uses: tailor-platform/actions/setup@");
      expect(content).toContain(`package-manager: ${pm}`);
    },
  );

  test("generatedIds list the managed jobs and steps", () => {
    const { generatedIds } = renderBranchWorkflow(branchBase);
    expect(generatedIds).toContain("tailor-plan");
    expect(generatedIds).toContain("tailor-plan/tailor-setup");
    expect(generatedIds).toContain("tailor-plan/tailor-generate-check");
    expect(generatedIds).toContain("tailor-deploy/tailor-setup");
    expect(generatedIds).toContain("tailor-deploy/tailor-apply");
    expect(generatedIds).not.toContain("tailor-plan/tailor-generate");
  });

  test("preserves $ characters in values", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, workingDirectory: "apps/a$&b" });
    expect(content).toContain("working-directory: apps/a$&b");
  });
});

describe("ERD preview artifacts per GitHub host", () => {
  const erdPreview = { namespaces: ["tailordb"] };
  const stepOf = (content: string, job: string, id: string) =>
    (parseYAML(content) as GeneratedWorkflow).jobs[job]?.steps.find((step) => step.id === id);
  const uploadOf = (content: string) =>
    stepOf(content, "tailor-erd-preview", "tailor-upload-erd-viewer");
  const commentPermissionsOf = (content: string) =>
    (parseYAML(content) as { jobs: Record<string, { permissions?: unknown }> }).jobs[
      "tailor-erd-preview-comment"
    ]?.permissions;

  const FAKE_GH = `#!/usr/bin/env bash
case "$GH_HOST" in
  github.com | *.ghe.com) token=$GH_TOKEN ;;
  *) token=$GH_ENTERPRISE_TOKEN ;;
esac
printf '%s %s\\n' "$GH_HOST" "$token" >> "$FAKE_GH_DIR/calls"
case "$*" in
  *"--method POST"*)
    for arg; do case "$arg" in body=*) printf '%s' "\${arg#body=}" > "$FAKE_GH_DIR/body" ;; esac; done ;;
  *"/pulls/"*) printf 'head-sha\\n' ;;
  *"/artifacts"*) printf '%s' "$FAKE_GH_ARTIFACTS" ;;
esac
`;

  const runComment = (
    content: string,
    serverUrl: string,
    listedArtifacts: string,
    namespaces = JSON.stringify(erdPreview.namespaces),
  ) => {
    using tmp = tempDir("erd-comment-");
    const bin = path.join(tmp.dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
    const context: Record<string, string> = {
      "github.token": "test-token",
      "github.repository": "acme/widgets",
      "github.run_id": "99",
      "github.server_url": serverUrl,
      "github.event.pull_request.number": "7",
      "github.event.pull_request.base.ref": "main",
      "github.event.pull_request.head.sha": "head-sha",
      "needs.tailor-erd-preview-matrix.outputs.namespaces": namespaces,
    };
    const step = stepOf(content, "tailor-erd-preview-comment", "tailor-comment-erd-preview");
    const env = Object.fromEntries(
      Object.entries(step?.env as Record<string, string>).map(([key, value]) => [
        key,
        value.replaceAll(/\$\{\{ ([\w.-]+) \}\}/g, (_match, expression: string) => {
          const resolved = context[expression];
          if (resolved === undefined) throw new Error(`No test value for ${expression}`);
          return resolved;
        }),
      ]),
    );
    execFileSync("bash", ["-c", String(step?.run)], {
      env: {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GITHUB_SERVER_URL: serverUrl,
        FAKE_GH_DIR: tmp.dir,
        FAKE_GH_ARTIFACTS: listedArtifacts,
        ...env,
      },
      stdio: "pipe",
    });
    return {
      calls: fs.readFileSync(path.join(tmp.dir, "calls"), "utf-8").trim().split("\n"),
      body: fs.readFileSync(path.join(tmp.dir, "body"), "utf-8"),
    };
  };

  test("on github.com, uploads each viewer unzipped and links its artifact", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, erdPreview });

    expect(uploadOf(content)?.uses).toBe(UPLOAD_ARTIFACT_GITHUB_COM);
    expect(uploadOf(content)?.with).toMatchObject({ archive: false });
    expect(commentPermissionsOf(content)).toEqual({ actions: "read", "pull-requests": "write" });

    const { calls, body } = runComment(
      content,
      "https://github.com",
      "tailordb-viewer.html\t123\n",
    );
    expect(new Set(calls)).toEqual(new Set(["github.com test-token"]));
    expect(body).toContain(
      "[tailordb-viewer.html](https://github.com/acme/widgets/actions/runs/99/artifacts/123)",
    );
  });

  test("on GitHub Enterprise Server, uploads with upload-artifact v3 and names the viewers before the run lists its artifacts", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, erdPreview, ghes: true });
    const dotcomUpload = uploadOf(renderBranchWorkflow({ ...branchBase, erdPreview }).content);
    const { archive, ...dotcomInputs } = (dotcomUpload?.with ?? {}) as Record<string, unknown>;

    expect(archive).toBe(false);
    expect(uploadOf(content)?.uses).toBe(UPLOAD_ARTIFACT_V3);
    expect(uploadOf(content)?.with).toEqual(dotcomInputs);
    expect(commentPermissionsOf(content)).toEqual({ "pull-requests": "write" });

    const { calls, body } = runComment(content, "https://ghes.example.com", "");
    expect(new Set(calls)).toEqual(new Set(["ghes.example.com test-token"]));
    expect(body).toContain("https://ghes.example.com/acme/widgets/actions/runs/99)");
    expect(body).toContain("- **tailordb viewer**: `tailordb-viewer.html`");
    expect(body).not.toContain("/artifacts/");
  });

  test("fails rather than commenting without viewers when they cannot be listed", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, erdPreview, ghes: true });

    expect(() => runComment(content, "https://ghes.example.com", "", "not json")).toThrow(
      /Command failed/,
    );
  });

  test("renders the github.com workflow unless ghes is set", () => {
    expect(renderBranchWorkflow({ ...branchBase, erdPreview, ghes: false })).toEqual(
      renderBranchWorkflow({ ...branchBase, erdPreview }),
    );
    expect(renderBranchWorkflow({ ...branchBase, ghes: true })).toEqual(
      renderBranchWorkflow(branchBase),
    );
  });

  test("keeps the GitHub Enterprise Server upload-artifact pin out of Renovate's updates", () => {
    const renovateConfig = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "../../../renovate.json"), "utf8"),
    ) as { customManagers: { managerFilePatterns: string[]; matchStrings: string[] }[] };
    const manager = renovateConfig.customManagers.find((m) =>
      m.managerFilePatterns.some((p) => p.includes("ya?ml")),
    );
    const updatable = (source: string) =>
      [...source.matchAll(new RegExp(manager!.matchStrings[0]!, "g"))]
        .filter((match) => match.groups?.depName === "actions/upload-artifact")
        .map((match) => match.groups?.currentValue);

    expect(updatable(renderBranchWorkflow({ ...branchBase, erdPreview }).content)).toEqual([
      UPLOAD_ARTIFACT_GITHUB_COM_VERSION,
    ]);
    expect(updatable(BRANCH_TEMPLATE)).toEqual([UPLOAD_ARTIFACT_GITHUB_COM_VERSION]);
    expect(
      updatable(renderBranchWorkflow({ ...branchBase, erdPreview, ghes: true }).content),
    ).toEqual([]);
  });
});

describe("multi-directory branch workflow", () => {
  const apps = [{ dir: "apps/erp/backend" }, { dir: "apps/users/backend" }];

  test("plans all configs in one run from the repository root", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, apps });
    const plan = (parseYAML(content) as GeneratedWorkflow).jobs["tailor-plan"]?.steps.find(
      (step) => step.id === "tailor-plan",
    );

    expect(plan?.env).toEqual({
      TAILOR_PLATFORM_SDK_CONFIG_PATH:
        "apps/erp/backend/tailor.config.ts,apps/users/backend/tailor.config.ts",
    });
    expect(plan?.with).not.toHaveProperty("working-directory");
  });

  test("deploys all configs in one run from the repository root", () => {
    const { content } = renderBranchWorkflow({ ...branchBase, apps });
    const apply = (parseYAML(content) as GeneratedWorkflow).jobs["tailor-deploy"]?.steps.find(
      (step) => step.id === "tailor-apply",
    );

    expect(apply?.env).toEqual({
      TAILOR_PLATFORM_SDK_CONFIG_PATH:
        "apps/erp/backend/tailor.config.ts,apps/users/backend/tailor.config.ts",
    });
    expect(apply?.with).not.toHaveProperty("working-directory");
  });

  test("checks generated files in each app directory with a step named after the directory", () => {
    const { content, generatedIds } = renderBranchWorkflow({ ...branchBase, apps });
    const checks = (parseYAML(content) as GeneratedWorkflow).jobs["tailor-plan"]?.steps.filter(
      (step) => String(step.id).startsWith("tailor-generate-check"),
    );

    expect(
      checks?.map((step) => [step.id, (step.with as Record<string, string>)["working-directory"]]),
    ).toEqual([
      ["tailor-generate-check-apps-erp-backend", "apps/erp/backend"],
      ["tailor-generate-check-apps-users-backend", "apps/users/backend"],
    ]);
    expect(generatedIds).toEqual(
      expect.arrayContaining([
        "tailor-plan/tailor-generate-check-apps-erp-backend",
        "tailor-plan/tailor-generate-check-apps-users-backend",
      ]),
    );
    expect(generatedIds).not.toContain("tailor-plan/tailor-generate-check");
  });

  test("validates seeds and checks migration drift only in the app directories that use them", () => {
    const { content, generatedIds } = renderBranchWorkflow({
      ...branchBase,
      apps: [
        { dir: "apps/erp/backend", seedValidate: true },
        { dir: "apps/users/backend", migrationDriftCheck: true },
      ],
    });
    const steps = (parseYAML(content) as GeneratedWorkflow).jobs["tailor-plan"]?.steps ?? [];
    const workingDirOf = (id: string) =>
      (steps.find((step) => step.id === id)?.["working-directory"] ??
        (steps.find((step) => step.id === id)?.with as Record<string, string> | undefined)?.[
          "working-directory"
        ]) as string | undefined;

    expect(workingDirOf("tailor-seed-validate-apps-erp-backend")).toBe("apps/erp/backend");
    expect(workingDirOf("tailor-migration-drift-check-apps-users-backend")).toBe(
      "apps/users/backend",
    );
    expect(generatedIds).toEqual(
      expect.arrayContaining([
        "tailor-plan/tailor-seed-validate-apps-erp-backend",
        "tailor-plan/tailor-migration-drift-check-apps-users-backend",
      ]),
    );
    expect(
      generatedIds.filter((id) => /seed-validate|migration-drift-check/.test(id)),
    ).toHaveLength(2);
  });
});

describe("ERD preview steps", () => {
  const workDir = path.join(
    "/tmp",
    `erd-matrix-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  aroundEach(async (runTest) => {
    fs.mkdirSync(workDir, { recursive: true });
    await runTest();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const writeLockAt = (dir: string, inputs: Record<string, unknown>): void => {
    fs.mkdirSync(path.join(workDir, dir, ".github"), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, dir, ".github/tailor.lock"),
      JSON.stringify({
        version: LOCK_VERSION,
        targets: [
          { kind: "branch", workspaceName: "erp", inputs: { erdPreview: true, ...inputs } },
        ],
      }),
    );
  };

  const runStep = (
    params: RenderBranchParams,
    jobId: string,
    stepId: string,
  ): Record<string, string> => {
    const { content } = renderBranchWorkflow(params);
    const step = (parseYAML(content) as GeneratedWorkflow).jobs[jobId]?.steps.find(
      (candidate) => candidate.id === stepId,
    );
    const outputFile = path.join(workDir, "github-output");
    fs.writeFileSync(outputFile, "");
    execFileSync("bash", ["-c", String(step?.run)], {
      cwd: workDir,
      env: {
        ...process.env,
        ...(step?.env as Record<string, string>),
        GITHUB_OUTPUT: outputFile,
      },
    });
    return Object.fromEntries(
      fs
        .readFileSync(outputFile, "utf-8")
        .trim()
        .split("\n")
        .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
    );
  };

  const runMatrix = (): Record<string, string> =>
    runStep(
      { ...branchBase, workspaceName: "erp", erdPreview: { namespaces: ["erp"] } },
      "tailor-erd-preview-matrix",
      "tailor-erd-preview-matrix",
    );

  test("maps each namespace to the app directory that owns it on each side", () => {
    writeLockAt(".", {
      dir: ".",
      erdNamespaces: ["erp", "users"],
      apps: [
        { dir: "apps/erp/backend", erdNamespaces: ["erp"] },
        { dir: "apps/users/backend", erdNamespaces: ["users"] },
      ],
    });
    writeLockAt(".tailor-erd-base", { dir: "apps/erp/backend", erdNamespaces: ["erp"] });

    const outputs = runMatrix();

    expect(JSON.parse(outputs.namespaces ?? "")).toEqual(["erp", "users"]);
    expect(JSON.parse(outputs["app-dirs"] ?? "")).toEqual({
      erp: "apps/erp/backend",
      users: "apps/users/backend",
    });
    expect(JSON.parse(outputs["base-app-dirs"] ?? "")).toEqual({
      erp: "apps/erp/backend",
      users: "apps/erp/backend",
    });
  });

  test("exports the base side from the head owner when the base branch has no setup target yet", () => {
    writeLockAt(".", {
      dir: ".",
      erdNamespaces: ["erp", "users"],
      apps: [
        { dir: "apps/erp/backend", erdNamespaces: ["erp"] },
        { dir: "apps/users/backend", erdNamespaces: ["users"] },
      ],
    });

    const outputs = runMatrix();

    expect(JSON.parse(outputs["base-app-dirs"] ?? "")).toEqual({
      erp: "apps/erp/backend",
      users: "apps/users/backend",
    });
  });

  test("maps every namespace of a single-directory target to that directory", () => {
    writeLockAt(".", { dir: "apps/backend", erdNamespaces: ["main", "audit"] });
    writeLockAt(".tailor-erd-base", { dir: "backend", erdNamespaces: ["main"] });

    const outputs = runMatrix();

    expect(JSON.parse(outputs["app-dirs"] ?? "")).toEqual({
      audit: "apps/backend",
      main: "apps/backend",
    });
    expect(JSON.parse(outputs["base-app-dirs"] ?? "")).toEqual({
      audit: "backend",
      main: "backend",
    });
  });

  test.each(LOCKFILES)(
    "detects the base package manager from %s over a different head",
    (lockfile, expected) => {
      fs.mkdirSync(path.join(workDir, ".tailor-erd-base"), { recursive: true });
      fs.writeFileSync(path.join(workDir, ".tailor-erd-base", lockfile), "");

      const outputs = runStep(
        {
          ...branchBase,
          packageManager: expected === "npm" ? "pnpm" : "npm",
          erdPreview: { namespaces: ["main"] },
        },
        "tailor-erd-preview",
        "tailor-detect-base-package-manager",
      );

      expect(outputs["package-manager"]).toBe(expected);
    },
  );
});

describe("change detection", () => {
  type Job = { needs?: string | string[]; if?: string; steps?: Array<Record<string, unknown>> };
  type Workflow = { on: Record<string, { paths?: string[] } | null>; jobs: Record<string, Job> };
  const previewBase = {
    workspaceName: "my-app",
    branch: "main",
    environment: "my-app",
    packageManager: "pnpm",
    region: "us-west",
  } as const;
  const patternsOf = (workflow: Workflow) =>
    String(
      (workflow.jobs["tailor-changes"]?.steps?.[0]?.with as Record<string, string> | undefined)?.[
        "path-patterns"
      ],
    )
      .trim()
      .split("\n");
  const gated = (job: Job | undefined) =>
    [job?.needs].flat().includes("tailor-changes") &&
    String(job?.if).includes("needs.tailor-changes.outputs.relevant == 'true'");

  // Evaluates the generated `if:` for a pull request run, mapping the GitHub
  // expression syntax used by the templates onto JavaScript.
  const runsOnPullRequest = (
    job: Job | undefined,
    changes: { result: "success" | "failure" | "cancelled"; relevant: string },
  ): boolean => {
    const expression = String(job?.if)
      .replaceAll("needs.tailor-changes.", "changes.")
      .replaceAll("inputs['dry-run']", "false");
    return Boolean(
      vm.runInNewContext(expression, {
        cancelled: () => changes.result === "cancelled",
        changes: { result: changes.result, outputs: { relevant: changes.relevant } },
        github: {
          event_name: "pull_request",
          event: {
            action: "opened",
            pull_request: { draft: false, head: { repo: { fork: false } }, labels: [] },
          },
        },
      }),
    );
  };

  test("fails every gated job when change detection fails, so a required check blocks merging", () => {
    const branch = renderBranchWorkflow({
      ...branchBase,
      workingDirectory: "apps/a",
      erdPreview: { namespaces: ["main"] },
    });
    const preview = renderPreviewWorkflow({ ...previewBase, workingDirectory: "apps/a" });
    const branchJobs = (parseYAML(branch.content) as Workflow).jobs;
    const previewJobs = (parseYAML(preview.content) as Workflow).jobs;
    const failed = { result: "failure", relevant: "" } as const;

    expect(runsOnPullRequest(branchJobs["tailor-plan"], failed)).toBe(true);
    expect(runsOnPullRequest(previewJobs["tailor-preview-deploy"], failed)).toBe(true);
    for (const job of [
      branchJobs["tailor-plan"],
      branchJobs["tailor-deploy"],
      branchJobs["tailor-erd-preview-matrix"],
      previewJobs["tailor-preview-deploy"],
    ]) {
      expect(job?.steps?.[0]).toMatchObject({
        id: "tailor-changes-guard",
        if: "needs.tailor-changes.result != 'success'",
        run: expect.stringContaining("exit 1"),
      });
    }
    expect(branch.generatedIds).toEqual(
      expect.arrayContaining([
        "tailor-plan/tailor-changes-guard",
        "tailor-deploy/tailor-changes-guard",
        "tailor-erd-preview-matrix/tailor-changes-guard",
      ]),
    );
    expect(preview.generatedIds).toContain("tailor-preview-deploy/tailor-changes-guard");
  });

  test("skips the plan only when change detection succeeded and found nothing relevant", () => {
    const { jobs } = parseYAML(
      renderBranchWorkflow({ ...branchBase, workingDirectory: "apps/a" }).content,
    ) as Workflow;

    expect(runsOnPullRequest(jobs["tailor-plan"], { result: "success", relevant: "false" })).toBe(
      false,
    );
    expect(runsOnPullRequest(jobs["tailor-plan"], { result: "success", relevant: "true" })).toBe(
      true,
    );
    expect(runsOnPullRequest(jobs["tailor-plan"], { result: "cancelled", relevant: "" })).toBe(
      false,
    );
  });

  test("starts the workflow on every change so its checks can be required", () => {
    const workflow = parseYAML(
      renderBranchWorkflow({ ...branchBase, apps: [{ dir: "apps/a" }, { dir: "apps/b" }] }).content,
    ) as Workflow;

    expect(workflow.on.pull_request?.paths).toBeUndefined();
    expect(workflow.on.push?.paths).toBeUndefined();
  });

  test("detects changes under every app directory, to the workflow file itself, and to the additional paths, in order", () => {
    const workflow = parseYAML(
      renderBranchWorkflow({
        ...branchBase,
        apps: [{ dir: "apps/a" }, { dir: "apps/b" }],
        extraPaths: ["modules/**", "!apps/a/**/*.md"],
      }).content,
    ) as Workflow;

    expect(patternsOf(workflow)).toEqual([
      "apps/a/**",
      "apps/b/**",
      ".github/workflows/tailor-my-app.yml",
      "modules/**",
      "!apps/a/**/*.md",
    ]);
  });

  test("runs the jobs when only the branch workflow file changes", () => {
    const workflow = parseYAML(
      renderBranchWorkflow({ ...branchBase, workingDirectory: "apps/a" }).content,
    ) as Workflow;

    expect(patternsOf(workflow)).toContain(".github/workflows/tailor-my-app.yml");
  });

  test("places the workflow file before the additional paths, so a later exclusion can drop it", () => {
    const workflow = parseYAML(
      renderBranchWorkflow({
        ...branchBase,
        workingDirectory: "apps/a",
        extraPaths: ["!.github/workflows/tailor-my-app.yml"],
      }).content,
    ) as Workflow;

    expect(patternsOf(workflow)).toEqual([
      "apps/a/**",
      ".github/workflows/tailor-my-app.yml",
      "!.github/workflows/tailor-my-app.yml",
    ]);
  });

  test("keeps an additional path that re-includes the workflow file after excluding it", () => {
    const workflow = parseYAML(
      renderBranchWorkflow({
        ...branchBase,
        workingDirectory: "apps/a",
        extraPaths: ["!.github/workflows/tailor-my-app.yml", ".github/workflows/tailor-my-app.yml"],
      }).content,
    ) as Workflow;

    expect(patternsOf(workflow)).toEqual([
      "apps/a/**",
      ".github/workflows/tailor-my-app.yml",
      "!.github/workflows/tailor-my-app.yml",
      ".github/workflows/tailor-my-app.yml",
    ]);
  });

  test("skips the plan, deploy, and ERD preview jobs of a branch workflow when nothing relevant changed", () => {
    const { content, generatedIds } = renderBranchWorkflow({
      ...branchBase,
      workingDirectory: "apps/a",
      erdPreview: { namespaces: ["main"] },
    });
    const { jobs } = parseYAML(content) as Workflow;

    expect(gated(jobs["tailor-plan"])).toBe(true);
    expect(gated(jobs["tailor-deploy"])).toBe(true);
    expect(gated(jobs["tailor-erd-preview-matrix"])).toBe(true);
    expect(generatedIds).toEqual(
      expect.arrayContaining(["tailor-changes", "tailor-changes/tailor-changes"]),
    );
  });

  test("skips the preview deploy when nothing relevant changed, but always cleans up", () => {
    const { jobs } = parseYAML(
      renderPreviewWorkflow({ ...previewBase, workingDirectory: "apps/a" }).content,
    ) as Workflow;

    expect(gated(jobs["tailor-preview-deploy"])).toBe(true);
    expect(jobs["tailor-preview-cleanup"]?.needs).toBeUndefined();
  });

  test("runs the preview deploy when only the preview workflow file changes", () => {
    const workflow = parseYAML(
      renderPreviewWorkflow({
        ...previewBase,
        workingDirectory: "apps/a",
        extraPaths: ["modules/**"],
      }).content,
    ) as Workflow;

    expect(patternsOf(workflow)).toEqual([
      "apps/a/**",
      ".github/workflows/tailor-my-app-preview.yml",
      "modules/**",
    ]);
  });

  test("generates no change detection for an app at the repository root", () => {
    const { content, generatedIds } = renderBranchWorkflow(branchBase);
    const { jobs } = parseYAML(content) as Workflow;

    expect(jobs["tailor-changes"]).toBeUndefined();
    expect(jobs["tailor-plan"]?.needs).toBeUndefined();
    expect(jobs["tailor-plan"]?.steps?.[0]?.id).toBe("tailor-checkout");
    expect(generatedIds).not.toContain("tailor-changes");
  });
});

describe("multi-directory tag workflow", () => {
  test("plans and deploys all configs in one run, checking each app directory", () => {
    const { content, generatedIds } = renderTagWorkflow({
      ...tagBase,
      apps: [{ dir: "apps/erp/backend", migrationDriftCheck: true }, { dir: "apps/users/backend" }],
    });
    const workflow = parseYAML(content) as GeneratedWorkflow;
    const configEnv = (job: string, id: string) =>
      workflow.jobs[job]?.steps.find((step) => step.id === id)?.env;

    expect(configEnv("tailor-plan", "tailor-plan")).toEqual({
      TAILOR_PLATFORM_SDK_CONFIG_PATH:
        "apps/erp/backend/tailor.config.ts,apps/users/backend/tailor.config.ts",
    });
    expect(configEnv("tailor-deploy", "tailor-apply")).toEqual(
      configEnv("tailor-plan", "tailor-plan"),
    );
    expect(generatedIds).toEqual(
      expect.arrayContaining([
        "tailor-plan/tailor-generate-check-apps-erp-backend",
        "tailor-plan/tailor-generate-check-apps-users-backend",
        "tailor-plan/tailor-migration-drift-check-apps-erp-backend",
      ]),
    );
    expect(generatedIds).not.toContain("tailor-plan/tailor-generate-check");
  });
});

describe("multi-directory preview workflow", () => {
  test("deploys all configs to the per-PR workspace in one run, checking each app directory", () => {
    const { content, generatedIds } = renderPreviewWorkflow({
      workspaceName: "my-app",
      branch: "main",
      environment: "my-app",
      packageManager: "pnpm",
      region: "us-west",
      apps: [{ dir: "apps/erp/backend" }, { dir: "apps/users/backend" }],
    });
    const deploy = (parseYAML(content) as GeneratedWorkflow).jobs[
      "tailor-preview-deploy"
    ]?.steps.find((step) => step.id === "tailor-preview-deploy");

    expect(deploy?.env).toEqual({
      TAILOR_PLATFORM_SDK_CONFIG_PATH:
        "apps/erp/backend/tailor.config.ts,apps/users/backend/tailor.config.ts",
    });
    expect(deploy?.with).not.toHaveProperty("working-directory");
    expect(generatedIds).toEqual(
      expect.arrayContaining([
        "tailor-preview-deploy/tailor-generate-check-apps-erp-backend",
        "tailor-preview-deploy/tailor-generate-check-apps-users-backend",
      ]),
    );
    expect(generatedIds).not.toContain("tailor-preview-deploy/tailor-generate-check");
  });
});

describe("renderTagWorkflow", () => {
  test("no guard: no tag-guard job, no needs/if on plan, parses", () => {
    const { content, generatedIds } = renderTagWorkflow(tagBase);
    expect(content).not.toMatch(NO_MARKER);
    expect(content).toContain('tags: ["v*"]');
    expect(content).not.toContain("tailor-tag-guard");
    expect(content).not.toContain("needs: tailor-tag-guard");
    expect(generatedIds).not.toContain("tailor-tag-guard");
    const parsed = parseYAML(content) as { jobs: Record<string, unknown> };
    expect(Object.keys(parsed.jobs)).toEqual(["tailor-plan", "tailor-deploy"]);
  });

  test("with guard: emits guard job gated by branch reachability", () => {
    const { content, generatedIds } = renderTagWorkflow({ ...tagBase, branch: "main" });
    expect(content).not.toMatch(NO_MARKER);
    expect(content).toContain("tailor-tag-guard:");
    expect(content).toContain("uses: tailor-platform/actions/tag-guard@");
    expect(content).toContain('target-branch: "main"');
    expect(content).toContain("needs: tailor-tag-guard");
    expect(content).toContain("needs.tailor-tag-guard.outputs.on-branch == 'true'");
    expect(generatedIds).toContain("tailor-tag-guard");
    const parsed = parseYAML(content) as { jobs: Record<string, unknown> };
    expect(Object.keys(parsed.jobs)).toEqual(["tailor-tag-guard", "tailor-plan", "tailor-deploy"]);
  });

  test("plan job omits github-token (step summary only)", () => {
    const { content } = renderTagWorkflow(tagBase);
    expect(content).not.toContain("github-token:");
  });

  test("custom tag pattern", () => {
    expect(renderTagWorkflow({ ...tagBase, tagPattern: "release-*" }).content).toContain(
      'tags: ["release-*"]',
    );
  });
});

describe("deploy job outputs", () => {
  test.each([
    ["branch", () => renderBranchWorkflow(branchBase).content],
    ["tag", () => renderTagWorkflow(tagBase).content],
  ] as const)(
    "%s workflow's deploy job exposes the deployed workspace id and app URL to user jobs",
    (_kind, render) => {
      const workflow = parseYAML(render()) as {
        jobs: Record<string, { outputs?: Record<string, string> }>;
      };

      expect(workflow.jobs["tailor-deploy"]?.outputs).toEqual({
        "workspace-id": "${{ steps.tailor-apply.outputs.workspace-id }}",
        "app-url": "${{ steps.tailor-apply.outputs.app-url }}",
      });
    },
  );
});

describe("renderPreviewWorkflow", () => {
  test("deploy job exposes the preview workspace id, name, and app URL to user jobs", () => {
    const { content } = renderPreviewWorkflow({
      workspaceName: "my-app",
      branch: "main",
      environment: "my-app",
      packageManager: "pnpm",
      region: "us-west",
    });
    const workflow = parseYAML(content) as {
      jobs: Record<string, { outputs?: Record<string, string> }>;
    };

    expect(workflow.jobs["tailor-preview-deploy"]?.outputs).toEqual({
      "workspace-id": "${{ steps.tailor-preview-deploy.outputs.workspace-id }}",
      "workspace-name": "${{ steps.tailor-preview-deploy.outputs.workspace-name }}",
      "app-url": "${{ steps.tailor-preview-deploy.outputs.app-url }}",
    });
  });

  describe("preview workspace expiry", () => {
    const { content } = renderPreviewWorkflow({
      workspaceName: "my-app",
      branch: "main",
      environment: "my-app",
      packageManager: "pnpm",
      region: "us-west",
    });
    const { jobs } = parseYAML(content) as {
      jobs: Record<string, { steps: { id?: string; with?: Record<string, string> }[] }>;
    };
    const withOf = (job: string, step: string) =>
      jobs[job]?.steps.find((s) => s.id === step)?.with ?? {};

    test("deploy records an expiry that a push to the pull request restarts", () => {
      expect(withOf("tailor-preview-deploy", "tailor-preview-deploy")["ttl"]).toBe("7d");
    });

    test("cleanup prunes expired previews from the location the deploy creates them in", () => {
      const deploy = withOf("tailor-preview-deploy", "tailor-preview-deploy");
      const cleanup = withOf("tailor-preview-cleanup", "tailor-preview-cleanup");

      expect(cleanup["prune-expired"]).toBe("true");
      expect(cleanup["organization-id"]).toBe(deploy["organization-id"]);
      expect(cleanup["folder-id"]).toBe(deploy["folder-id"]);
    });
  });

  test.each([false, true])(
    "cancels a superseded run as a whole, except from an event on a closed pull request (requirePreviewLabel: %s)",
    (requirePreviewLabel) => {
      const { content } = renderPreviewWorkflow({
        workspaceName: "my-app",
        branch: "main",
        environment: "my-app",
        packageManager: "pnpm",
        region: "us-west",
        requirePreviewLabel,
      });
      const workflow = parseYAML(content) as {
        concurrency?: { group?: string; "cancel-in-progress"?: boolean };
        jobs: Record<string, Record<string, unknown>>;
      };
      const groupOn = (action: string, state: "open" | "closed") =>
        String(workflow.concurrency?.group).replace(/\$\{\{(.*?)\}\}/g, (_match, expression) =>
          String(
            vm.runInNewContext(expression, {
              format: (template: string, ...args: unknown[]) =>
                template.replace(/\{(\d+)\}/g, (_m, index) => String(args[Number(index)])),
              github: { run_id: 9001, event: { action, pull_request: { number: 42, state } } },
            }),
          ),
        );

      expect(workflow.concurrency?.["cancel-in-progress"]).toBe(true);
      expect(groupOn("synchronize", "open")).toBe("tailor-preview-my-app-pr-42");
      expect(groupOn("reopened", "open")).toBe("tailor-preview-my-app-pr-42");
      expect(groupOn("closed", "closed")).toBe("tailor-preview-my-app-pr-42");
      expect(groupOn("labeled", "closed")).toBe("tailor-preview-my-app-run-9001");
      for (const job of Object.values(workflow.jobs)) {
        expect(job).not.toHaveProperty("concurrency");
      }
    },
  );
});

describe("workflow result job", () => {
  type Job = {
    name?: string;
    needs?: string[];
    if?: string;
    permissions?: Record<string, string>;
    steps?: Array<Record<string, unknown>>;
  };
  const jobsOf = (content: string) => (parseYAML(content) as { jobs: Record<string, Job> }).jobs;
  const previewBase = {
    workspaceName: "my-app",
    branch: "main",
    environment: "my-app",
    packageManager: "pnpm",
    region: "us-west",
  } as const;
  const variants = [
    ["branch", renderBranchWorkflow(branchBase), "tailor-result", ["tailor-plan", "tailor-deploy"]],
    [
      "branch with change detection and ERD preview",
      renderBranchWorkflow({
        ...branchBase,
        workingDirectory: "apps/a",
        erdPreview: { namespaces: ["main"] },
      }),
      "tailor-result",
      [
        "tailor-changes",
        "tailor-plan",
        "tailor-erd-preview-matrix",
        "tailor-erd-preview",
        "tailor-erd-preview-comment",
        "tailor-deploy",
      ],
    ],
    [
      "preview",
      renderPreviewWorkflow(previewBase),
      "tailor-preview-result",
      ["tailor-preview-deploy", "tailor-preview-cleanup"],
    ],
    [
      "preview with change detection",
      renderPreviewWorkflow({ ...previewBase, workingDirectory: "apps/a" }),
      "tailor-preview-result",
      ["tailor-changes", "tailor-preview-deploy", "tailor-preview-cleanup"],
    ],
  ] as const;

  test.each(variants)(
    "%s workflow ends with a result job that always runs after every other managed job",
    (_name, render, resultJob, needs) => {
      const jobs = jobsOf(render.content);

      expect(Object.keys(jobs).at(-1)).toBe(resultJob);
      expect(jobs[resultJob]).toMatchObject({ needs, if: "always()", permissions: {} });
      expect(render.generatedIds).toEqual(
        expect.arrayContaining([resultJob, `${resultJob}/${resultJob}`]),
      );
    },
  );

  test("names the check after the workspace so several workflows can each be required", () => {
    expect(jobsOf(renderBranchWorkflow(branchBase).content)["tailor-result"]?.name).toBe(
      "tailor-result (my-app)",
    );
    expect(jobsOf(renderPreviewWorkflow(previewBase).content)["tailor-preview-result"]?.name).toBe(
      "tailor-preview-result (my-app)",
    );
  });

  // Evaluates the result step's `if:`, mapping the GitHub expression syntax it
  // uses onto JavaScript; the step fails the job whenever it runs.
  const failsOn = (results: readonly string[]) =>
    variants.map(([, render, resultJob]) => {
      const step = jobsOf(render.content)[resultJob]?.steps?.[0];
      expect(step?.run).toContain("exit 1");
      return Boolean(
        vm.runInNewContext(String(step?.if).replaceAll("needs.*.result", "results"), {
          always: () => true,
          contains: (values: readonly string[], value: string) => values.includes(value),
          results,
        }),
      );
    });

  test.each([
    [["success", "success"], false],
    [["success", "skipped"], false],
    [["skipped", "skipped"], false],
    [["success", "failure"], true],
    [["skipped", "cancelled"], true],
  ] as const)("fails when the needed jobs end in %j: %s", (results, fails) => {
    expect(failsOn(results)).toEqual(variants.map(() => fails));
  });

  test("is not mentioned in a tag workflow, which has none", () => {
    expect(renderTagWorkflow(tagBase).content).not.toMatch(/tailor-(preview-)?result/);
  });

  test("checks the results even when the workflow run is cancelled", () => {
    for (const [, render, resultJob] of variants) {
      expect(jobsOf(render.content)[resultJob]?.steps?.[0]?.if).toMatch(/^always\(\) && /);
    }
  });
});

type WorkflowJob = {
  name?: string;
  if?: string;
  environment?: string;
  "timeout-minutes"?: number;
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress": boolean; queue?: string };
  steps: { id?: string; if?: string; env?: Record<string, string>; run?: string }[];
};
type Workflow = {
  on: { pull_request: { types?: string[] } };
  jobs: Record<string, WorkflowJob>;
};

describe("renderBranchWorkflow migration test job", () => {
  const migrationTest = { label: "tailor:migration-test" };
  const render = (overrides: Partial<RenderBranchParams> = {}) => {
    const { content, generatedIds } = renderBranchWorkflow({
      ...branchBase,
      migrationDriftCheck: true,
      migrationTest,
      ...overrides,
    });
    return { content, generatedIds, workflow: parseYAML(content) as Workflow };
  };

  test("renders no migration test job and keeps the default pull_request types when disabled", () => {
    const { content, generatedIds } = renderBranchWorkflow({
      ...branchBase,
      migrationDriftCheck: true,
    });
    const workflow = parseYAML(content) as Workflow;

    expect(workflow.jobs["tailor-migration-test"]).toBeUndefined();
    expect(workflow.on.pull_request.types).toBeUndefined();
    expect(generatedIds.some((id) => id.startsWith("tailor-migration-test"))).toBe(false);
    expect(content).not.toMatch(NO_MARKER);
  });

  test("leaves no unreplaced marker in the rendered workflow", () => {
    const { content } = render({ workingDirectory: "apps/backend" });

    expect(content).not.toMatch(NO_MARKER);
  });

  test("adds the labeled event to the pull_request types", () => {
    const { workflow } = render();

    expect(workflow.on.pull_request.types).toEqual([
      "opened",
      "synchronize",
      "reopened",
      "labeled",
    ]);
  });

  test("runs only when the configured label is added to a same-repository pull request", () => {
    const { workflow } = render();
    const job = workflow.jobs["tailor-migration-test"]!;

    expect(job.if).toBe(
      [
        "github.event_name == 'pull_request' &&",
        "github.event.action == 'labeled' &&",
        "github.event.label.name == 'tailor:migration-test' &&",
        "github.event.pull_request.head.repo.full_name == github.repository",
      ].join("\n"),
    );
  });

  test("keeps plan and ERD jobs from re-running when any label is added", () => {
    const { workflow } = render({ erdPreview: { namespaces: ["main"] } });

    expect(workflow.jobs["tailor-plan"]?.if).toContain("github.event.action != 'labeled'");
    expect(workflow.jobs["tailor-erd-preview-matrix"]?.if).toContain(
      "github.event.action != 'labeled'",
    );
  });

  test("publishes label events under a check name the required result check never shares", () => {
    const labelRun = render().workflow.jobs["tailor-result"]!;
    const plain = renderBranchWorkflow(branchBase).content;

    expect(labelRun.name).toBe(
      "${{ github.event.action == 'labeled' && 'tailor-result (my-app) [label]' || 'tailor-result (my-app)' }}",
    );
    expect((parseYAML(plain) as Workflow).jobs["tailor-result"]).toMatchObject({
      name: "tailor-result (my-app)",
    });
  });

  test("uses the plan environment and its workspace variable by default", () => {
    const { workflow } = render();
    const job = workflow.jobs["tailor-migration-test"]!;
    const run = job.steps.find((step) => step.id === "tailor-migration-test");

    expect(job.environment).toBe("my-app");
    expect(run?.env?.TAILOR_PLATFORM_WORKSPACE_ID).toBe("${{ vars.TAILOR_PLATFORM_WORKSPACE_ID }}");
  });

  test("renders a dedicated environment name that YAML would read as a boolean as a string", () => {
    const { workflow } = render({ migrationTest: { ...migrationTest, environment: "true" } });

    expect(workflow.jobs["tailor-migration-test"]?.environment).toBe("true");
  });

  test("uses a dedicated environment and its source workspace variable when given", () => {
    const { workflow } = render({
      migrationTest: { ...migrationTest, environment: "prod-readonly" },
    });
    const job = workflow.jobs["tailor-migration-test"]!;
    const run = job.steps.find((step) => step.id === "tailor-migration-test");

    expect(job.environment).toBe("prod-readonly");
    expect(run?.env?.TAILOR_PLATFORM_WORKSPACE_ID).toBe(
      "${{ vars.TAILOR_PLATFORM_MIGRATION_TEST_SOURCE_WORKSPACE_ID }}",
    );
  });

  test("runs migration test on cloned data with a clone timeout, under a job time limit", () => {
    const { workflow } = render();
    const job = workflow.jobs["tailor-migration-test"]!;
    const run = job.steps.find((step) => step.id === "tailor-migration-test");

    expect(run?.run).toContain(
      "pnpm exec tailor tailordb migration test --data clone --yes --clone-timeout 30m --json",
    );
    expect(job["timeout-minutes"]).toBe(60);
  });

  test("signs in with the machine user only in the login step", () => {
    const { workflow } = render();
    const steps = workflow.jobs["tailor-migration-test"]!.steps;
    const login = steps.find((step) => step.id === "tailor-migration-test-login");

    expect(login?.run).toContain("pnpm exec tailor login --machine-user");
    expect(login?.env).toEqual({
      TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:
        "${{ vars.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID || secrets.TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID }}",
      TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:
        "${{ secrets.TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET }}",
    });
    expect(
      steps.filter((step) => step.env?.TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET),
    ).toHaveLength(1);
  });

  test("always removes the label as the last step, with minimal permissions", () => {
    const { workflow } = render();
    const job = workflow.jobs["tailor-migration-test"]!;
    const last = job.steps.at(-1)!;

    expect(last.id).toBe("tailor-migration-test-unlabel");
    expect(last.if).toBe("always()");
    expect(last.env?.LABEL).toBe("tailor:migration-test");
    expect(last.run).toContain("DELETE");
    expect(job.permissions).toEqual({ contents: "read", "pull-requests": "write" });
  });

  test("bounds the migration test step below the job limit so the label is still removed", () => {
    const { workflow } = render();
    const job = workflow.jobs["tailor-migration-test"]!;
    const run = job.steps.find((step) => step.id === "tailor-migration-test") as {
      "timeout-minutes"?: number;
    };

    expect(run["timeout-minutes"]).toBe(50);
    expect(run["timeout-minutes"]).toBeLessThan(job["timeout-minutes"]!);
  });

  test("never cancels a running migration test for the same pull request", () => {
    const { workflow } = render();

    expect(workflow.jobs["tailor-migration-test"]?.concurrency).toEqual({
      group: "tailor-migration-test-my-app-${{ github.event.pull_request.number }}",
      "cancel-in-progress": false,
      queue: "max",
    });
  });

  test("records the job and its steps as managed ids", () => {
    const { generatedIds } = render();

    expect(generatedIds).toEqual(
      expect.arrayContaining([
        "tailor-migration-test",
        "tailor-migration-test/tailor-checkout",
        "tailor-migration-test/tailor-setup",
        "tailor-migration-test/tailor-install",
        "tailor-migration-test/tailor-migration-test-login",
        "tailor-migration-test/tailor-migration-test",
        "tailor-migration-test/tailor-migration-test-unlabel",
      ]),
    );
  });

  test("runs the CLI steps in the working directory", () => {
    const { workflow } = render({ workingDirectory: "apps/backend" });
    const run = workflow.jobs["tailor-migration-test"]!.steps.find(
      (step) => step.id === "tailor-migration-test",
    ) as { "working-directory"?: string };

    expect(run["working-directory"]).toBe("apps/backend");
  });
});

describe("Tailor Platform action pins", () => {
  test("pins every generated Tailor Platform action to the release pin", () => {
    expect(ACTIONS_SHA).toMatch(/^[0-9a-f]{40}$/);
    expect(ACTIONS_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);

    const contents = [
      renderBranchWorkflow({ ...branchBase, migrationDriftCheck: true }).content,
      renderBranchWorkflow({ ...branchBase, migrationTest: { label: "tailor:migration-test" } })
        .content,
      renderTagWorkflow({ ...tagBase, branch: "main" }).content,
      renderPreviewWorkflow({
        workspaceName: "my-app",
        branch: "main",
        environment: "my-app",
        packageManager: "pnpm",
        region: "us-west",
      }).content,
    ];

    for (const content of contents) {
      const refs = [
        ...content.matchAll(/tailor-platform\/actions\/\S+?@(\S+?)(?:\s+#\s+(\S+))?(?=\s|$)/g),
      ];
      expect(refs.length).toBeGreaterThan(0);
      for (const [, sha, version] of refs) {
        expect({ sha, version }).toEqual({
          sha: ACTIONS_SHA,
          version: ACTIONS_VERSION,
        });
      }
    }
  });

  test("Renovate's custom manager regex actually matches this file's ACTIONS_SHA/ACTIONS_VERSION declarations", () => {
    const renovateConfig = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "../../../renovate.json"), "utf8"),
    ) as { customManagers: { managerFilePatterns: string[]; matchStrings: string[] }[] };

    const manager = renovateConfig.customManagers.find((m) =>
      m.managerFilePatterns.some((p) => p.includes("templates")),
    );
    expect(manager).toBeDefined();

    const templatesSource = fs.readFileSync(path.join(import.meta.dirname, "templates.ts"), "utf8");
    const match = new RegExp(manager!.matchStrings[0]).exec(templatesSource);

    expect(match?.groups).toEqual({
      currentDigest: ACTIONS_SHA,
      currentValue: ACTIONS_VERSION,
    });
  });
});

describe("drift check failure policy", () => {
  test("passes the repository opt-in to every generated drift-check action", () => {
    const workflows = [
      [renderBranchWorkflow(branchBase).content, "tailor-plan"],
      [renderTagWorkflow(tagBase).content, "tailor-plan"],
      [
        renderPreviewWorkflow({
          workspaceName: "my-app",
          branch: "main",
          environment: "my-app",
          packageManager: "pnpm",
          region: "us-west",
        }).content,
        "tailor-preview-deploy",
      ],
    ] as const;

    for (const [content, jobId] of workflows) {
      const workflow = parseYAML(content) as GeneratedWorkflow;
      const driftSteps = workflow.jobs[jobId]?.steps.filter(
        (step) => step.id === "tailor-drift-check",
      );
      expect(driftSteps).toHaveLength(1);
      expect(driftSteps?.[0]?.with).toMatchObject({
        "fail-on-drift": "${{ vars.TAILOR_PLATFORM_FAIL_ON_DRIFT == 'true' }}",
      });
    }
  });
});

describe("seed validation step", () => {
  test.each([
    ["pnpm", "pnpm exec tailor seed validate"],
    ["npm", "npx @tailor-platform/sdk seed validate"],
    ["yarn", "yarn tailor seed validate"],
    ["bun", "bun run tailor seed validate"],
  ] as const)(
    "uses the installed CLI for %s in branch and tag workflows",
    (packageManager, run) => {
      const workflows = [
        renderBranchWorkflow({
          ...branchBase,
          packageManager,
          seedValidate: true,
          workingDirectory: "apps/api",
        }).content,
        renderTagWorkflow({
          ...tagBase,
          packageManager,
          seedValidate: true,
          workingDirectory: "apps/api",
        }).content,
      ];

      for (const content of workflows) {
        const workflow = parseYAML(content) as GeneratedWorkflow;
        const seedValidateStep = workflow.jobs["tailor-plan"]?.steps.find(
          (step) => step.id === "tailor-seed-validate",
        );

        expect(seedValidateStep).toEqual({
          id: "tailor-seed-validate",
          run,
          "working-directory": "apps/api",
        });
        expect(content).not.toContain("tailor-platform/actions/seed-validate@");
        expect(content).not.toContain(".tailor-sdk/exec.mjs");
      }
    },
  );
});

describe("seed step", () => {
  const stepsOf = (content: string, job: string): Array<Record<string, unknown>> =>
    (parseYAML(content) as GeneratedWorkflow).jobs[job]?.steps ?? [];
  const idsOf = (steps: Array<Record<string, unknown>>): unknown[] => steps.map((s) => s.id);

  test("validates branch seed data before deploy when deploy events skip the plan job", () => {
    const { content, generatedIds } = renderBranchWorkflow({
      ...branchBase,
      workingDirectory: "apps/api",
      seedValidate: true,
      seed: { datasets: ["preview"] },
    });
    const workflow = parseYAML(content) as GeneratedWorkflow;
    expect(workflow.jobs["tailor-plan"]?.if).toContain("github.event_name == 'pull_request'");
    expect(workflow.jobs["tailor-deploy"]?.if).toContain("github.event_name == 'push'");
    const steps = stepsOf(content, "tailor-deploy");
    const ids = idsOf(steps);
    const validationIndex = ids.indexOf("tailor-seed-validate");
    expect(validationIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeLessThan(ids.indexOf("tailor-apply"));
    expect(steps[validationIndex]).toEqual({
      id: "tailor-seed-validate",
      run: "pnpm exec tailor seed validate --upsert --dataset preview",
      "working-directory": "apps/api",
    });
    expect(generatedIds).toContain("tailor-deploy/tailor-seed-validate");

    const tag = renderTagWorkflow({ ...tagBase, seedValidate: true, seed: { datasets: [] } });
    expect(idsOf(stepsOf(tag.content, "tailor-deploy"))).not.toContain("tailor-seed-validate");
    const withoutSeed = renderBranchWorkflow({ ...branchBase, seedValidate: true });
    expect(idsOf(stepsOf(withoutSeed.content, "tailor-deploy"))).not.toContain(
      "tailor-seed-validate",
    );
    expect(withoutSeed.generatedIds).not.toContain("tailor-deploy/tailor-seed-validate");
  });

  test("branch and tag workflows seed after the apply step without repeating validation", () => {
    const rendered = [
      renderBranchWorkflow({
        ...branchBase,
        workingDirectory: "apps/api",
        seedValidate: true,
        seed: { datasets: [] },
      }),
      renderTagWorkflow({
        ...tagBase,
        workingDirectory: "apps/api",
        seedValidate: true,
        seed: { datasets: [] },
      }),
    ];

    for (const { content, generatedIds } of rendered) {
      const steps = stepsOf(content, "tailor-deploy");
      const index = idsOf(steps).indexOf("tailor-seed");
      expect(idsOf(steps)[index - 1]).toBe("tailor-apply");
      expect(steps[index]).toEqual({
        id: "tailor-seed",
        shell: "bash",
        "working-directory": "apps/api",
        env: { TAILOR_PLATFORM_WORKSPACE_ID: "${{ vars.TAILOR_PLATFORM_WORKSPACE_ID }}" },
        run: "pnpm exec tailor seed apply --upsert\n",
      });
      expect(generatedIds).toContain("tailor-deploy/tailor-seed");
      expect(
        stepsOf(content, "tailor-plan").find((step) => step.id === "tailor-seed-validate")?.run,
      ).toBe("pnpm exec tailor seed validate --upsert");
      expect(content).not.toMatch(NO_MARKER);
    }
  });

  test("the preview workflow reseeds the preview workspace with --truncate before commenting", () => {
    const { content, generatedIds } = renderPreviewWorkflow({
      workspaceName: "my-app",
      branch: "main",
      environment: "my-app",
      packageManager: "npm",
      region: "us-west",
      seed: { datasets: [] },
    });

    const steps = stepsOf(content, "tailor-preview-deploy");
    const index = idsOf(steps).indexOf("tailor-seed");
    expect(idsOf(steps).slice(index - 1, index + 2)).toEqual([
      "tailor-preview-deploy",
      "tailor-seed",
      "tailor-preview-comment",
    ]);
    expect(steps[index]).toEqual({
      id: "tailor-seed",
      shell: "bash",
      env: {
        TAILOR_PLATFORM_WORKSPACE_ID: "${{ steps.tailor-preview-deploy.outputs.workspace-id }}",
      },
      run:
        "npx @tailor-platform/sdk seed validate\n" +
        "npx @tailor-platform/sdk seed apply --truncate --yes\n",
    });
    expect(generatedIds).toContain("tailor-preview-deploy/tailor-seed");
    expect(content).not.toMatch(NO_MARKER);
  });

  test("passes the datasets to the seed step and to the plan job's validation", () => {
    const { content } = renderBranchWorkflow({
      ...branchBase,
      seedValidate: true,
      seed: { datasets: ["preview", "local"] },
    });

    const validate = stepsOf(content, "tailor-plan").find((s) => s.id === "tailor-seed-validate");
    expect(validate?.run).toBe(
      "pnpm exec tailor seed validate --upsert --dataset preview --dataset local",
    );
    const seed = stepsOf(content, "tailor-deploy").find((s) => s.id === "tailor-seed");
    expect(seed?.run).toBe(
      "pnpm exec tailor seed apply --upsert --dataset preview --dataset local\n",
    );
  });

  test("leaves the seed step out unless seeding is enabled", () => {
    const rendered = [
      renderBranchWorkflow(branchBase),
      renderTagWorkflow(tagBase),
      renderPreviewWorkflow({
        workspaceName: "my-app",
        branch: "main",
        environment: "my-app",
        packageManager: "pnpm",
        region: "us-west",
      }),
    ];

    for (const { content, generatedIds } of rendered) {
      expect(content).not.toContain("tailor-seed\n");
      expect(content).not.toContain("seed apply");
      expect(content).not.toContain("seed-data");
      expect(generatedIds.filter((id) => id.endsWith("/tailor-seed"))).toEqual([]);
    }
  });
});

describe("detectDefaultBranch", () => {
  test("strips the origin/ prefix", () => {
    const run = vi.fn().mockReturnValue("origin/main");
    expect(detectDefaultBranch("/repo", run)).toBe("main");
  });

  test("throws an AI-first error when the ref is missing", () => {
    const run = vi.fn().mockReturnValue(null);
    expect(() => detectDefaultBranch("/repo", run)).toThrow(/--branch|set-head/);
  });

  test("suggests the caller's branch flag in the remediation hint", () => {
    const run = vi.fn().mockReturnValue(null);
    expect(() => detectDefaultBranch("/repo", run, "--target")).toThrow(/--target/);
  });
});

describe("decideAction", () => {
  const rendered = renderBranchWorkflow(branchBase);
  const target = {
    kind: "branch" as const,
    workspaceName: "my-app",
    file: ".github/workflows/tailor-my-app.yml",
    templateVersion: 1,
    inputs: {} as never,
    generatedIds: rendered.generatedIds,
    contentHash: computeManagedHash(rendered.content, rendered.generatedIds),
  };
  const legacyTarget = { ...target, contentHash: hashContent("name: managed\n") };
  const withUserStep = rendered.content.replace(
    "      - id: tailor-apply\n",
    "      - name: Mine\n        run: echo mine\n      - id: tailor-apply\n",
  );
  const managedEdit = rendered.content.replace('branches: ["main"]', 'branches: ["dev"]');

  test.each([
    ["create: no lock entry, no file", undefined, false, null, false, { action: "create" }],
    [
      "conflict: no lock entry but file exists",
      undefined,
      true,
      "x",
      false,
      { action: "conflict" },
    ],
    ["--force adopts an unmanaged file", undefined, true, "x", true, { action: "adopt" }],
    [
      "regenerate: managed parts unchanged",
      target,
      true,
      withUserStep,
      false,
      { action: "regenerate", force: false },
    ],
    [
      "--force carries over when managed parts are unchanged",
      target,
      true,
      withUserStep,
      true,
      { action: "regenerate", force: true },
    ],
    ["conflict: managed parts edited", target, true, managedEdit, false, { action: "conflict" }],
    [
      "--force resets managed edits",
      target,
      true,
      managedEdit,
      true,
      { action: "regenerate", force: true },
    ],
    ["conflict: invalid YAML", target, true, "jobs: [", false, { action: "conflict" }],
    ["--force replaces invalid YAML", target, true, "jobs: [", true, { action: "adopt" }],
    ["restore: lock entry, file missing", target, false, null, false, { action: "restore" }],
    [
      "regenerate: legacy whole-file hash matches",
      legacyTarget,
      true,
      "name: managed\n",
      false,
      { action: "regenerate", force: false },
    ],
    [
      "conflict: legacy whole-file hash differs",
      legacyTarget,
      true,
      "name: edited\n",
      false,
      { action: "conflict" },
    ],
  ] as const)("%s", (_name, existing, fileExists, currentContent, force, expected) => {
    expect(decideAction({ existing, fileExists, currentContent, force })).toMatchObject(expected);
  });

  test.each([
    ["an older whole-file", legacyTarget, /older setup version.*--force once/],
    ["a managed-part", target, /SDK-managed parts/],
  ])("explains a hand edit against %s lock hash", (_name, existing, reason) => {
    expect(
      decideAction({ existing, fileExists: true, currentContent: managedEdit, force: false }),
    ).toEqual({ action: "conflict", reason: expect.stringMatching(reason) });
  });
});

describe("setupTarget (integration)", () => {
  const testDir = path.join(
    "/tmp",
    `setup-gh-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const writeConfig = (body: string): void => {
    fs.writeFileSync(path.join(testDir, "tailor.config.ts"), body, "utf-8");
  };

  const baseOptions = (overrides: Partial<BranchSetupOptions> = {}): BranchSetupOptions => ({
    kind: "branch",
    erdPreview: false,
    dir: ".",
    force: false,
    outputDir: testDir,
    branch: "main",
    gitRunner: () => "origin/main",
    loadConfigName: async () => "cfg-app",
    loadConfigId: async () => undefined,
    ...overrides,
  });

  aroundEach(async (runTest) => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "cfg-app" });\n`,
    );
    await runTest();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("generates a workflow + lock and derives the name from config", async () => {
    await setupTarget(baseOptions({ workspaceName: undefined }));
    const wf = path.join(testDir, ".github/workflows/tailor-cfg-app.yml");
    expect(fs.existsSync(wf)).toBe(true);
    const lock = readLock(testDir);
    expect(lock?.targets).toHaveLength(1);
    expect(lock?.targets[0]).toMatchObject({ kind: "branch", workspaceName: "cfg-app" });
    const target = lock?.targets[0];
    expect(target?.contentHash).toBe(
      computeManagedHash(fs.readFileSync(wf, "utf-8"), target?.generatedIds ?? []),
    );
  });

  test("defaults the environment to the workspace name", async () => {
    await setupTarget(baseOptions({ workspaceName: "my-app" }));
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf.match(/environment: my-app/g)).toHaveLength(2);
    expect(readLock(testDir)?.targets[0]?.inputs.environment).toBe("my-app");
  });

  test("uses an explicit --environment over the workspace name", async () => {
    await setupTarget(baseOptions({ workspaceName: "my-app", environment: "production" }));
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf).toContain("environment: production");
    expect(readLock(testDir)?.targets[0]?.inputs.environment).toBe("production");
  });

  test("records a package manager detected from the root lockfile as auto-detected", async () => {
    await setupTarget(baseOptions({ workspaceName: "my-app" }));
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf).toContain("package-manager: pnpm");
    expect(readLock(testDir)?.targets[0]?.inputs).toMatchObject({
      packageManager: "pnpm",
      packageManagerAutoDetected: true,
    });
  });

  test("uses an explicit --package-manager over the root lockfile", async () => {
    await setupTarget(baseOptions({ workspaceName: "my-app", packageManager: "yarn" }));
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf).toContain("package-manager: yarn");
    expect(wf).not.toContain("package-manager: pnpm");
    expect(readLock(testDir)?.targets[0]?.inputs).toMatchObject({
      packageManager: "yarn",
      packageManagerAutoDetected: false,
    });
  });

  test("stops before loading the config, without writing anything, when no package manager can be detected", async () => {
    fs.rmSync(path.join(testDir, "pnpm-lock.yaml"));
    const loadConfigName = vi.fn(async () => "cfg-app");

    await expect(setupTarget(baseOptions({ loadConfigName }))).rejects.toThrow(
      /Could not detect the package manager[\s\S]*--package-manager/,
    );
    expect(loadConfigName).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(testDir, ".github"))).toBe(false);
  });

  test("records ERD preview namespaces in the generated workflow and lock", async () => {
    await setupTarget(
      baseOptions({
        workspaceName: "my-app",
        erdPreview: true,
        loadErdNamespaces: async () => ["tailordb", "analyticsdb"],
      }),
    );

    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    const lock = readLock(testDir);
    expect(wf).toContain("tailor-erd-preview:");
    expect(wf).toContain(
      "namespace: ${{ fromJSON(needs.tailor-erd-preview-matrix.outputs.namespaces) }}",
    );
    expect(lock?.targets[0]?.inputs.erdPreview).toBe(true);
    expect(lock?.targets[0]?.inputs.erdNamespaces).toEqual(["tailordb", "analyticsdb"]);
  });

  test("rejects ERD preview when no owned TailorDB namespaces exist", async () => {
    await expect(
      setupTarget(
        baseOptions({
          workspaceName: "my-app",
          erdPreview: true,
          loadErdNamespaces: async () => [],
        }),
      ),
    ).rejects.toThrow(/No TailorDB namespaces/);
  });

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const EXISTING_ID = "c98794dd-9bf1-480f-a5c9-bf92b3679d42";

  test("records a generated app id in the lock and leaves the config alone", async () => {
    const before = fs.readFileSync(path.join(testDir, "tailor.config.ts"), "utf-8");
    await setupTarget(baseOptions({ workspaceName: "my-app" }));
    const lock = readLock(testDir);
    expect(lock?.version).toBe(LOCK_VERSION);
    expect(lock?.appIds?.["tailor.config.ts"]).toMatch(UUID);
    expect(fs.readFileSync(path.join(testDir, "tailor.config.ts"), "utf-8")).toBe(before);
  });

  test("keys the app id by the config path under --dir", async () => {
    fs.mkdirSync(path.join(testDir, "apps/api"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "apps/api/tailor.config.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "api" });\n`,
    );
    await setupTarget(baseOptions({ workspaceName: "api", dir: "./apps/api/" }));
    expect(Object.keys(readLock(testDir)?.appIds ?? {})).toEqual(["apps/api/tailor.config.ts"]);
  });

  test("moves an existing config id into the lock and deletes it from the config", async () => {
    writeConfig(
      `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  // SDK-managed app id — do not edit, except when copying this config to a separate app.
  id: "${EXISTING_ID}",
  name: "cfg-app",
});
`,
    );
    await setupTarget(
      baseOptions({ workspaceName: "my-app", loadConfigId: async () => EXISTING_ID }),
    );
    expect(readLock(testDir)?.appIds).toEqual({ "tailor.config.ts": EXISTING_ID });
    expect(fs.readFileSync(path.join(testDir, "tailor.config.ts"), "utf-8")).toBe(
      `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  name: "cfg-app",
});
`,
    );
  });

  test("keeps the recorded app id and other entries across reruns", async () => {
    const opts = baseOptions({ workspaceName: "my-app" });
    await setupTarget(opts);
    const first = readLock(testDir);
    const other = "11111111-1111-4111-8111-111111111111";
    writeLock(testDir, {
      ...(first as NonNullable<typeof first>),
      appIds: { ...first?.appIds, "apps/other/tailor.config.ts": other },
    });
    fs.mkdirSync(path.join(testDir, "apps/other"), { recursive: true });
    fs.writeFileSync(path.join(testDir, "apps/other/tailor.config.ts"), "");

    await setupTarget({ ...opts, force: true });
    expect(readLock(testDir)?.appIds).toEqual({
      "tailor.config.ts": first?.appIds?.["tailor.config.ts"],
      "apps/other/tailor.config.ts": other,
    });
  });

  test("refuses to record an app id when a nearer lock governs the config", async () => {
    fs.mkdirSync(path.join(testDir, "apps/api/.github"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "apps/api/.github/tailor.lock"),
      `${JSON.stringify({ version: 2, targets: [] }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(testDir, "apps/api/tailor.config.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "api" });\n`,
    );
    await expect(
      setupTarget(baseOptions({ workspaceName: "api", dir: "apps/api" })),
    ).rejects.toThrow(/apps\/api\/.github\/tailor.lock already governs/);
    expect(fs.existsSync(path.join(testDir, ".github/tailor.lock"))).toBe(false);
  });

  test("stops before writing anything when the config id disagrees with the lock", async () => {
    await setupTarget(baseOptions({ workspaceName: "my-app" }));
    const lockBefore = fs.readFileSync(path.join(testDir, ".github/tailor.lock"), "utf-8");
    await expect(
      setupTarget(
        baseOptions({
          workspaceName: "my-app",
          force: true,
          loadConfigId: async () => EXISTING_ID,
        }),
      ),
    ).rejects.toMatchObject({
      code: "APP_ID_CONFLICT",
      suggestion: expect.stringMatching(/Neither can be chosen automatically/),
    });
    expect(fs.readFileSync(path.join(testDir, ".github/tailor.lock"), "utf-8")).toBe(lockBefore);
  });

  test("silent regenerate when hash matches", async () => {
    const opts = baseOptions({ workspaceName: "my-app" });
    await setupTarget(opts);
    await expect(setupTarget(opts)).resolves.toMatchObject({
      file: ".github/workflows/tailor-my-app.yml",
    });
  });

  test("errors on a hand edit to a managed part without --force", async () => {
    const opts = baseOptions({ workspaceName: "my-app" });
    await setupTarget(opts);
    const wf = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    const generated = fs.readFileSync(wf, "utf-8");
    fs.writeFileSync(
      wf,
      generated.replace("timeout-minutes: 30", "timeout-minutes: 30\n    services: {}"),
    );
    await expect(setupTarget(opts)).rejects.toThrow(/edited by hand: "tailor-plan"\..*--force/);
    await setupTarget({ ...opts, force: true });
    expect(fs.readFileSync(wf, "utf-8")).toBe(generated);
  });

  test("records a managed hash that an older plugin cannot match", async () => {
    const opts = baseOptions({ workspaceName: "my-app" });
    await setupTarget(opts);
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    const contentHash = readLock(testDir)?.targets[0]?.contentHash ?? "";
    expect(isManagedHash(contentHash)).toBe(true);
    expect(contentHash).not.toBe(hashContent(wf));
  });

  describe("user-owned content", () => {
    const wfPath = () => path.join(testDir, ".github/workflows/tailor-my-app.yml");
    const addUserContent = (content: string): string =>
      content
        .replace(
          "      - id: tailor-apply\n",
          "      - name: Registry auth\n        run: echo auth\n      - id: tailor-apply\n",
        )
        .concat(
          "  frontend:\n    needs: tailor-deploy\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo deploy\n",
        );

    test("survives a rerun without --force", async () => {
      const opts = baseOptions({ workspaceName: "my-app" });
      await setupTarget(opts);
      const edited = addUserContent(fs.readFileSync(wfPath(), "utf-8"));
      fs.writeFileSync(wfPath(), edited);
      await setupTarget(opts);
      expect(fs.readFileSync(wfPath(), "utf-8")).toBe(edited);
    });

    test("survives --force while managed edits are reset", async () => {
      const opts = baseOptions({ workspaceName: "my-app" });
      await setupTarget(opts);
      const withUser = addUserContent(fs.readFileSync(wfPath(), "utf-8"));
      fs.writeFileSync(wfPath(), withUser.replace('branches: ["main"]', 'branches: ["dev"]'));
      await expect(setupTarget(opts)).rejects.toThrow(/--force/);
      await setupTarget({ ...opts, force: true });
      expect(fs.readFileSync(wfPath(), "utf-8")).toBe(withUser);
    });

    test("migrates a legacy whole-file lock entry and keeps the user content", async () => {
      const opts = baseOptions({ workspaceName: "my-app" });
      await setupTarget(opts);
      const edited = addUserContent(fs.readFileSync(wfPath(), "utf-8"));
      fs.writeFileSync(wfPath(), edited);
      const lock = readLock(testDir);
      const [target] = lock?.targets ?? [];
      if (!lock || !target) throw new Error("expected a lock target");
      writeLock(testDir, { ...lock, targets: [{ ...target, contentHash: hashContent(edited) }] });

      await setupTarget(opts);

      expect(fs.readFileSync(wfPath(), "utf-8")).toBe(edited);
      expect(isManagedHash(readLock(testDir)?.targets[0]?.contentHash ?? "")).toBe(true);
    });

    test("keeps the user content of a legacy entry on the first --force", async () => {
      const opts = baseOptions({ workspaceName: "my-app" });
      await setupTarget(opts);
      const generated = fs.readFileSync(wfPath(), "utf-8");
      const edited = addUserContent(generated);
      fs.writeFileSync(wfPath(), edited.replaceAll("tailor-slack-prereq", "slack-prereq"));
      const lock = readLock(testDir);
      const [target] = lock?.targets ?? [];
      if (!lock || !target) throw new Error("expected a lock target");
      writeLock(testDir, {
        ...lock,
        targets: [
          {
            ...target,
            contentHash: hashContent(generated),
            generatedIds: target.generatedIds.filter(
              (id) => id !== "tailor-deploy/tailor-slack-prereq",
            ),
          },
        ],
      });

      await expect(setupTarget(opts)).rejects.toThrow(/--force/);
      await setupTarget({ ...opts, force: true });

      expect(fs.readFileSync(wfPath(), "utf-8")).toBe(edited);
    });

    test.each([false, true])(
      "stops on a user tailor- step in a legacy entry, naming it (force: %s)",
      async (force) => {
        const opts = baseOptions({ workspaceName: "my-app" });
        await setupTarget(opts);
        const generated = fs.readFileSync(wfPath(), "utf-8");
        const edited = generated.replace(
          "      - id: tailor-apply\n",
          "      - id: tailor-build-frontend\n        run: echo build\n      - id: tailor-apply\n",
        );
        fs.writeFileSync(wfPath(), edited);
        const lock = readLock(testDir);
        const [target] = lock?.targets ?? [];
        if (!lock || !target) throw new Error("expected a lock target");
        writeLock(testDir, {
          ...lock,
          targets: [{ ...target, contentHash: hashContent(generated) }],
        });

        await expect(setupTarget({ ...opts, force })).rejects.toThrow(
          /"tailor-deploy\/tailor-build-frontend" uses the tailor- prefix/,
        );

        expect(fs.readFileSync(wfPath(), "utf-8")).toBe(edited);
      },
    );

    test("runs the jobs it adds on the runner every managed job was moved to", async () => {
      const opts = baseOptions({ workspaceName: "my-app" });
      await setupTarget(opts);
      const edited = fs
        .readFileSync(wfPath(), "utf-8")
        .replaceAll("runs-on: ubuntu-latest", "runs-on: [self-hosted, linux]");
      fs.writeFileSync(wfPath(), edited);
      const erdOpts = { ...opts, erdPreview: true, loadErdNamespaces: async () => ["tailordb"] };

      await setupTarget(erdOpts);

      const content = fs.readFileSync(wfPath(), "utf-8");
      expect(content).toContain("  tailor-erd-preview:\n");
      expect(content).not.toContain("ubuntu-latest");
      const [target] = readLock(testDir)?.targets ?? [];
      expect(target?.contentHash).toBe(computeManagedHash(content, target?.generatedIds ?? []));
      await setupTarget(erdOpts);
      expect(fs.readFileSync(wfPath(), "utf-8")).toBe(content);
    });

    test("replaces an invalid YAML file of a legacy entry on --force", async () => {
      const opts = baseOptions({ workspaceName: "my-app" });
      await setupTarget(opts);
      const generated = fs.readFileSync(wfPath(), "utf-8");
      fs.appendFileSync(wfPath(), "jobs: [\n");
      const lock = readLock(testDir);
      const [target] = lock?.targets ?? [];
      if (!lock || !target) throw new Error("expected a lock target");
      writeLock(testDir, {
        ...lock,
        targets: [{ ...target, contentHash: hashContent(generated) }],
      });

      await expect(setupTarget(opts)).rejects.toThrow(/not valid YAML/);
      await setupTarget({ ...opts, force: true });

      expect(fs.readFileSync(wfPath(), "utf-8")).toBe(generated);
    });
  });

  test("records and renders --restrict-dispatch", async () => {
    await setupTarget(baseOptions({ workspaceName: "my-app", restrictDispatch: true }));
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf).toContain("github.ref == 'refs/heads/main'");
    expect(readLock(testDir)?.targets[0]).toMatchObject({ inputs: { restrictDispatch: true } });
  });

  describe("--ghes", () => {
    const wfPath = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    const erdOptions = (ghes: boolean) =>
      baseOptions({
        workspaceName: "my-app",
        erdPreview: true,
        ghes,
        loadErdNamespaces: async () => ["tailordb"],
      });

    test("records the choice and uploads ERD viewers with upload-artifact v3", async () => {
      await setupTarget(erdOptions(true));

      expect(fs.readFileSync(wfPath, "utf-8")).toContain(UPLOAD_ARTIFACT_V3);
      expect(readLock(testDir)?.targets[0]?.inputs).toMatchObject({ erdPreview: true, ghes: true });
    });

    test("is not recorded when off", async () => {
      await setupTarget(erdOptions(false));

      expect(fs.readFileSync(wfPath, "utf-8")).toContain(UPLOAD_ARTIFACT_GITHUB_COM);
      expect(readLock(testDir)?.targets[0]?.inputs).not.toHaveProperty("ghes");
    });

    test("is rejected without --erd-preview, before anything is written", async () => {
      await expect(
        setupTarget(baseOptions({ workspaceName: "my-app", ghes: true })),
      ).rejects.toThrow(/--ghes .*--erd-preview/);

      expect(fs.existsSync(wfPath)).toBe(false);
      expect(readLock(testDir)).toBeNull();
    });

    test("switches an existing workflow to and from GitHub Enterprise Server without --force", async () => {
      await setupTarget(erdOptions(false));
      await setupTarget(erdOptions(true));
      expect(fs.readFileSync(wfPath, "utf-8")).toContain(UPLOAD_ARTIFACT_V3);
      expect(fs.readFileSync(wfPath, "utf-8")).not.toContain(UPLOAD_ARTIFACT_GITHUB_COM);

      await setupTarget(erdOptions(false));
      expect(fs.readFileSync(wfPath, "utf-8")).toContain(UPLOAD_ARTIFACT_GITHUB_COM);
      expect(fs.readFileSync(wfPath, "utf-8")).not.toContain(UPLOAD_ARTIFACT_V3);
      expect(readLock(testDir)?.targets[0]?.inputs).not.toHaveProperty("ghes");
    });
  });

  test("errors on an unmanaged pre-existing file", async () => {
    const wf = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    fs.mkdirSync(path.dirname(wf), { recursive: true });
    fs.writeFileSync(wf, "name: hand written\n");
    await expect(setupTarget(baseOptions({ workspaceName: "my-app" }))).rejects.toThrow(
      /unmanaged|--force/,
    );
  });

  test("restores a deleted file from the lock", async () => {
    const opts = baseOptions({ workspaceName: "my-app" });
    await setupTarget(opts);
    const wf = path.join(testDir, ".github/workflows/tailor-my-app.yml");
    fs.rmSync(wf);
    await setupTarget(opts);
    expect(fs.existsSync(wf)).toBe(true);
  });

  test("rejects an invalid workspace name", async () => {
    await expect(setupTarget(baseOptions({ workspaceName: "Bad_Name" }))).rejects.toThrow(
      /Invalid workspace name/,
    );
  });

  describe("preview name length", () => {
    type PreviewOptions = Extract<SetupTargetOptions, { kind: "preview" }>;
    const previewOptions = (overrides: Partial<PreviewOptions> = {}): PreviewOptions => ({
      kind: "preview",
      region: "us-west",
      dir: ".",
      force: false,
      outputDir: testDir,
      gitRunner: () => "origin/main",
      loadConfigName: async () => "cfg-app",
      loadConfigId: async () => undefined,
      ...overrides,
    });

    test("accepts a 50-character preview name", async () => {
      const name = "a".repeat(50);
      await setupTarget(previewOptions({ workspaceName: name }));
      expect(readLock(testDir)?.targets[0]).toMatchObject({ kind: "preview", workspaceName: name });
    });

    test.each([
      ["--name", { workspaceName: "a".repeat(51) }],
      ["the config name", { loadConfigName: async () => "a".repeat(51) }],
    ] as const)(
      "rejects a 51-character preview name from %s before writing anything",
      async (_label, overrides) => {
        await expect(setupTarget(previewOptions(overrides))).rejects.toThrow(
          /at most 50 characters[\s\S]*-pr-<number>/,
        );
        expect(fs.existsSync(path.join(testDir, ".github"))).toBe(false);
      },
    );

    test("branch and tag targets still accept a 63-character name", async () => {
      const name = "a".repeat(63);
      await setupTarget(baseOptions({ workspaceName: name }));
      await setupTarget({ ...baseOptions({ workspaceName: name }), kind: "tag", tagPattern: "v*" });
      expect(readLock(testDir)?.targets.map((t) => [t.kind, t.workspaceName])).toEqual([
        ["branch", name],
        ["tag", name],
      ]);
    });
  });

  test.each([
    ["branch name", { branch: "feat,bar" }, /Invalid branch name/],
    ["environment name", { environment: "prod: evil" }, /Invalid environment name/],
    ["--dir", { dir: "apps/${{ evil }}" }, /Invalid --dir/],
  ] as const)("rejects a %s with YAML-unsafe characters", async (_label, overrides, error) => {
    await expect(
      setupTarget(baseOptions({ workspaceName: "my-app", ...overrides })),
    ).rejects.toThrow(error);
  });

  test("rejects a tag pattern with YAML-unsafe characters", async () => {
    await expect(
      setupTarget({
        kind: "tag",
        workspaceName: "my-app",
        tagPattern: "v* #${{ evil }}",
        dir: ".",
        force: false,
        outputDir: testDir,
        gitRunner: () => "origin/main",
        loadConfigName: async () => "cfg-app",
        loadConfigId: async () => undefined,
      }),
    ).rejects.toThrow(/Invalid tag pattern/);
  });

  test("normalizes a --dir with ./ prefix and trailing slash", async () => {
    fs.mkdirSync(path.join(testDir, "apps/backend"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "apps/backend/tailor.config.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "my-app" });\n`,
      "utf-8",
    );
    const opts = baseOptions({
      workspaceName: "my-app",
      dir: "./apps/backend/",
      loadConfigName: async () => "my-app",
      loadConfigId: async () => undefined,
    });
    await setupTarget(opts);
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf).toContain("path-patterns: |\n            apps/backend/**\n");
    expect(wf).not.toContain("apps/backend//");
    expect(wf).not.toContain('["./apps');
  });

  test("errors when the config is missing", async () => {
    fs.rmSync(path.join(testDir, "tailor.config.ts"));
    await expect(setupTarget(baseOptions({ workspaceName: "my-app" }))).rejects.toThrow(
      /tailor\.config\.ts not found/,
    );
  });

  test("branch and tag targets coexist under the same workspace name", async () => {
    // Branch target generates tailor-my-app.yml; tag target generates
    // tailor-my-app-tag.yml — no filename collision, no --name workaround needed.
    await setupTarget(baseOptions({ workspaceName: "my-app" }));
    await expect(
      setupTarget({
        kind: "tag",
        workspaceName: "my-app",
        tagPattern: "v*",
        dir: ".",
        force: false,
        outputDir: testDir,
        gitRunner: () => "origin/main",
        loadConfigName: async () => "cfg-app",
        loadConfigId: async () => undefined,
      }),
    ).resolves.toMatchObject({ file: ".github/workflows/tailor-my-app-tag.yml" });
    const lock = readLock(testDir);
    expect(lock?.targets).toHaveLength(2);
    expect(lock?.targets.map((t) => t.file).toSorted()).toEqual([
      ".github/workflows/tailor-my-app-tag.yml",
      ".github/workflows/tailor-my-app.yml",
    ]);
  });

  test("next steps point to `tailor setup ci env` for the environment's secrets and variables", async () => {
    using log = vi.spyOn(logger, "log").mockImplementation(() => {});
    printTargetNextSteps(
      await setupTarget(baseOptions({ workspaceName: "my-app", environment: "stg" })),
    );
    const output = log.mock.calls.map(([line]) => line).join("\n");

    expect(output).toContain("tailor setup ci env --environment stg");
    expect(output).not.toContain("gh secret set");
  });

  test("next steps suggest checking with --check what the environment still lacks", async () => {
    using log = vi.spyOn(logger, "log").mockImplementation(() => {});
    printTargetNextSteps(
      await setupTarget(baseOptions({ workspaceName: "my-app", environment: "stg" })),
    );
    const output = log.mock.calls.map(([line]) => line).join("\n");

    expect(output).toMatch(/tailor setup ci env --environment stg --check +# .*still missing/);
  });

  test("next steps leave where each value comes from to `tailor setup ci env`", async () => {
    using log = vi.spyOn(logger, "log").mockImplementation(() => {});
    printTargetNextSteps(
      await setupTarget(baseOptions({ workspaceName: "my-app", environment: "stg" })),
    );
    const output = log.mock.calls.map(([line]) => line).join("\n");

    expect(output).toContain("where each value comes from");
    expect(output).not.toContain("tailor workspace create");
  });

  test("preview next steps do not ask for a workspace id", async () => {
    using log = vi.spyOn(logger, "log").mockImplementation(() => {});
    printTargetNextSteps(
      await setupTarget({
        kind: "preview",
        workspaceName: "my-app",
        region: "us-west",
        dir: ".",
        force: false,
        outputDir: testDir,
        gitRunner: () => "origin/main",
        loadConfigName: async () => "my-app",
        loadConfigId: async () => undefined,
      }),
    );
    const output = log.mock.calls.map(([line]) => line).join("\n");

    expect(output).toContain("tailor setup ci env");
    expect(output).not.toContain("TAILOR_PLATFORM_WORKSPACE_ID");
    expect(output).not.toContain("tailor workspace create");
  });

  test("preview: generates a -preview.yml workflow and records kind in lock", async () => {
    await setupTarget({
      kind: "preview",
      workspaceName: "my-app",
      region: "us-west",
      dir: ".",
      force: false,
      outputDir: testDir,
      gitRunner: () => "origin/main",
      loadConfigName: async () => "my-app",
      loadConfigId: async () => undefined,
    });
    const wf = path.join(testDir, ".github/workflows/tailor-my-app-preview.yml");
    expect(fs.existsSync(wf)).toBe(true);
    const content = fs.readFileSync(wf, "utf-8");
    expect(() => parseYAML(content)).not.toThrow();
    expect(content).not.toMatch(NO_MARKER);
    expect(content).toContain("id: tailor-drift-check");
    const lock = readLock(testDir);
    expect(lock?.targets[0]).toMatchObject({ kind: "preview", workspaceName: "my-app" });
    expect(lock?.targets[0]?.generatedIds).toContain("tailor-preview-deploy/tailor-drift-check");
  });

  test("preview: re-running on a workflow from before the deploy job had outputs adds them and keeps user jobs that read them", async () => {
    const opts = {
      kind: "preview",
      workspaceName: "my-app",
      region: "us-west",
      dir: ".",
      force: false,
      outputDir: testDir,
      gitRunner: () => "origin/main",
      loadConfigName: async () => "my-app",
      loadConfigId: async () => undefined,
    } as const;
    await setupTarget(opts);
    const wf = path.join(testDir, ".github/workflows/tailor-my-app-preview.yml");
    const outputsBlock =
      "    outputs:\n" +
      "      workspace-id: ${{ steps.tailor-preview-deploy.outputs.workspace-id }}\n" +
      "      workspace-name: ${{ steps.tailor-preview-deploy.outputs.workspace-name }}\n" +
      "      app-url: ${{ steps.tailor-preview-deploy.outputs.app-url }}\n";
    const userJob =
      "  e2e:\n" +
      "    needs: tailor-preview-deploy\n" +
      "    runs-on: ubuntu-latest\n" +
      "    steps:\n" +
      "      - run: echo ${{ needs.tailor-preview-deploy.outputs.app-url }}\n";
    const generated = fs.readFileSync(wf, "utf-8");
    expect(generated).toContain(outputsBlock);
    const legacy = generated.replace(outputsBlock, "").concat(userJob);
    fs.writeFileSync(wf, legacy);
    const lock = readLock(testDir);
    const [target] = lock?.targets ?? [];
    if (!lock || !target) throw new Error("expected a lock target");
    writeLock(testDir, {
      ...lock,
      targets: [
        {
          ...target,
          templateVersion: TEMPLATE_VERSION - 1,
          contentHash: computeManagedHash(legacy, target.generatedIds),
        },
      ],
    });

    await setupTarget(opts);

    expect(fs.readFileSync(wf, "utf-8")).toBe(generated.concat(userJob));
  });

  describe("preview: re-running on a workflow whose concurrency was on the deploy job", () => {
    const opts = {
      kind: "preview",
      workspaceName: "my-app",
      region: "us-west",
      dir: ".",
      force: false,
      outputDir: testDir,
      gitRunner: () => "origin/main",
      loadConfigName: async () => "my-app",
      loadConfigId: async () => undefined,
    } as const;
    const wf = path.join(testDir, ".github/workflows/tailor-my-app-preview.yml");
    const topLevelConcurrency = /^concurrency:\n(?: {2}.*\n)+\n/m;
    const jobConcurrency =
      "    concurrency:\n" +
      "      group: tailor-preview-my-app-${{ github.event.pull_request.number }}\n" +
      "      cancel-in-progress: true\n";
    const userConcurrency =
      "concurrency:\n" +
      "  group: mine-${{ github.workflow }}-${{ github.event.pull_request.number }}\n" +
      "  cancel-in-progress: true\n\n";
    const writeLegacy = (generated: string, topLevel: string) => {
      expect(generated).toMatch(topLevelConcurrency);
      const legacy = generated
        .replace(topLevelConcurrency, topLevel)
        .replace("    outputs:\n", `${jobConcurrency}    outputs:\n`);
      expect(legacy).toContain(jobConcurrency);
      fs.writeFileSync(wf, legacy);
      const lock = readLock(testDir);
      const [target] = lock?.targets ?? [];
      if (!lock || !target) throw new Error("expected a lock target");
      writeLock(testDir, {
        ...lock,
        targets: [
          {
            ...target,
            templateVersion: TEMPLATE_VERSION - 1,
            contentHash: computeManagedHash(legacy, target.generatedIds),
          },
        ],
      });
    };

    test("moves it to the top level", async () => {
      await setupTarget(opts);
      const generated = fs.readFileSync(wf, "utf-8");
      writeLegacy(generated, "");

      await setupTarget(opts);

      expect(fs.readFileSync(wf, "utf-8")).toBe(generated);
    });

    test("keeps a top-level concurrency the user added", async () => {
      await setupTarget(opts);
      const generated = fs.readFileSync(wf, "utf-8");
      writeLegacy(generated, userConcurrency);

      await setupTarget(opts);

      expect(fs.readFileSync(wf, "utf-8")).toBe(
        generated.replace(topLevelConcurrency, userConcurrency),
      );
    });
  });

  test("preview: require-preview-label variant adds label filter to trigger", async () => {
    await setupTarget({
      kind: "preview",
      workspaceName: "my-app",
      region: "us-west",
      requirePreviewLabel: true,
      dir: ".",
      force: false,
      outputDir: testDir,
      gitRunner: () => "origin/main",
      loadConfigName: async () => "my-app",
      loadConfigId: async () => undefined,
    });
    const content = fs.readFileSync(
      path.join(testDir, ".github/workflows/tailor-my-app-preview.yml"),
      "utf-8",
    );
    expect(content).toContain("tailor:preview");
    expect(content).toContain("labeled");
  });

  test("preview: rejects an invalid region", async () => {
    await expect(
      setupTarget({
        kind: "preview",
        workspaceName: "my-app",
        region: "us-west ${{ evil }}",
        dir: ".",
        force: false,
        outputDir: testDir,
        gitRunner: () => "origin/main",
        loadConfigName: async () => "my-app",
        loadConfigId: async () => undefined,
      }),
    ).rejects.toThrow(/Invalid region/);
  });

  test("enables migration-drift-check step and lock flag when loadHasMigrations returns true", async () => {
    await setupTarget(
      baseOptions({ workspaceName: "my-app", loadHasMigrations: async () => true }),
    );
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf).toContain("tailor-migration-drift-check");
    const lock = readLock(testDir);
    expect(lock?.targets[0]).toMatchObject({ inputs: { migrationDriftCheck: true } });
  });

  describe("migration test", () => {
    const enabled = (overrides: Partial<BranchSetupOptions> = {}) =>
      baseOptions({
        workspaceName: "my-app",
        loadHasMigrations: async () => true,
        migrationTest: true,
        ...overrides,
      });
    const readWorkflow = () =>
      parseYAML(
        fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8"),
      ) as Workflow;

    test("generates the job with the default label and clone data, and records the inputs in the lock", async () => {
      await setupTarget(enabled());

      expect(readWorkflow().jobs["tailor-migration-test"]?.if).toContain(
        "github.event.label.name == 'tailor:migration-test'",
      );
      expect(readLock(testDir)?.targets[0]).toMatchObject({
        inputs: {
          migrationTest: true,
          migrationTestLabel: "tailor:migration-test",
        },
      });
    });

    test("records and renders a custom label and dedicated environment", async () => {
      await setupTarget(
        enabled({
          migrationTestLabel: "run-migration-test",
          migrationTestEnvironment: "prod-source",
        }),
      );

      const job = readWorkflow().jobs["tailor-migration-test"]!;
      expect(job.environment).toBe("prod-source");
      expect(job.if).toContain("github.event.label.name == 'run-migration-test'");
      expect(readLock(testDir)?.targets[0]).toMatchObject({
        inputs: {
          migrationTestLabel: "run-migration-test",
          migrationTestEnvironment: "prod-source",
        },
      });
    });

    test("rejects enabling it for a config without TailorDB migrations", async () => {
      await expect(setupTarget(enabled({ loadHasMigrations: async () => false }))).rejects.toThrow(
        /--migration-test.*migrations/,
      );
    });

    test("rejects the migration test options without --migration-test", async () => {
      await expect(
        setupTarget(
          baseOptions({
            workspaceName: "my-app",
            loadHasMigrations: async () => true,
            migrationTestLabel: "x",
          }),
        ),
      ).rejects.toThrow(/require --migration-test/);
    });

    test("rejects a label longer than GitHub's 50 character limit", async () => {
      await expect(setupTarget(enabled({ migrationTestLabel: "a".repeat(51) }))).rejects.toThrow(
        /Invalid --migration-test-label.*50/,
      );
      await expect(
        setupTarget(enabled({ migrationTestLabel: "a".repeat(50) })),
      ).resolves.toBeDefined();
    });

    test.each(["has'quote", "bad\nlabel", ""])("rejects the unsafe label %j", async (label) => {
      await expect(setupTarget(enabled({ migrationTestLabel: label }))).rejects.toThrow(
        /Invalid --migration-test-label/,
      );
    });
  });

  test("enables seed-validate step and lock flag when loadHasSeeds returns true", async () => {
    await setupTarget(baseOptions({ workspaceName: "my-app", loadHasSeeds: async () => true }));
    const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"), "utf-8");
    expect(wf).toContain("tailor-seed-validate");
    const lock = readLock(testDir);
    expect(lock?.targets[0]).toMatchObject({ inputs: { seedValidate: true } });
  });

  describe("--seed", () => {
    const seedSettings =
      (
        overrides: {
          machineUserName?: string;
          datasets?: Record<string, string[]>;
          dataDir?: string;
        } = {},
      ) =>
      async () => ({
        machineUserName: "admin",
        datasets: {},
        dataDir: path.join(testDir, "seed/data"),
        ...overrides,
      });

    test("seeds after each deploy and records the datasets in the lock", async () => {
      fs.mkdirSync(path.join(testDir, "seed/data/cogs"), { recursive: true });
      fs.mkdirSync(path.join(testDir, "seed/data/shipments"), { recursive: true });

      await setupTarget(
        baseOptions({
          workspaceName: "my-app",
          seed: { datasets: ["preview", "cogs"] },
          loadHasSeeds: async () => true,
          loadSeedSettings: seedSettings({ datasets: { preview: ["shipments"] } }),
        }),
      );

      const wf = fs.readFileSync(
        path.join(testDir, ".github/workflows/tailor-my-app.yml"),
        "utf-8",
      );
      expect(wf).toContain("pnpm exec tailor seed apply --upsert --dataset preview --dataset cogs");
      const target = readLock(testDir)?.targets[0];
      expect(target?.inputs.seed).toEqual({ datasets: ["preview", "cogs"] });
      expect(target?.generatedIds).toContain("tailor-deploy/tailor-seed");
    });

    test("reads the machine user, datasets, and data directory from seedPlugin in the app's config", async () => {
      const appDir = path.join(testDir, "apps/seeded");
      fs.mkdirSync(path.join(appDir, "seed/data/cogs"), { recursive: true });
      fs.writeFileSync(
        path.join(appDir, "tailor.config.ts"),
        [
          `import { defineConfig, definePlugins } from "@tailor-platform/sdk";`,
          `import { seedPlugin } from "${import.meta.resolve("@tailor-platform/sdk/plugin/seed")}";`,
          `export default defineConfig({ name: "seeded" });`,
          `export const plugins = definePlugins(`,
          `  seedPlugin({ distPath: "./seed", machineUserName: "admin", datasets: { preview: ["cogs"] } }),`,
          `);`,
          ``,
        ].join("\n"),
      );
      const options = (datasets: string[]) =>
        baseOptions({
          workspaceName: "seeded",
          dir: "apps/seeded",
          seed: { datasets },
          force: true,
        });

      await setupTarget(options(["preview", "cogs"]));
      await expect(setupTarget(options(["shipments"]))).rejects.toThrow(
        `Unknown seed dataset "shipments". Datasets in seedPlugin options: preview. ` +
          `It is not a directory in ${path.join(appDir, "seed/data")} either.`,
      );
    });

    test("keeps a user step right after the deploy step as seeding is turned on and off", async () => {
      fs.mkdirSync(path.join(testDir, "seed/data"), { recursive: true });
      const file = path.join(testDir, ".github/workflows/tailor-my-app.yml");
      const deployStepIds = (): unknown[] =>
        (parseYAML(fs.readFileSync(file, "utf-8")) as GeneratedWorkflow).jobs[
          "tailor-deploy"
        ]?.steps.map((step) => step.id) ?? [];
      const seedOff = baseOptions({ workspaceName: "my-app" });
      const seedOn = baseOptions({
        workspaceName: "my-app",
        seed: { datasets: [] },
        loadSeedSettings: seedSettings(),
      });

      await setupTarget(seedOff);
      fs.writeFileSync(
        file,
        fs
          .readFileSync(file, "utf-8")
          .replace(
            "      - id: tailor-slack-prereq\n",
            "      - id: smoke\n        run: echo smoke\n      - id: tailor-slack-prereq\n",
          ),
      );

      await setupTarget(seedOn);
      const ids = deployStepIds();
      expect(ids.slice(ids.indexOf("tailor-apply"), ids.indexOf("tailor-apply") + 3)).toEqual([
        "tailor-apply",
        "smoke",
        "tailor-seed",
      ]);

      await setupTarget(seedOff);
      expect(deployStepIds()).not.toContain("tailor-seed");
      expect(deployStepIds()).toContain("smoke");
      expect(readLock(testDir)?.targets[0]?.inputs.seed).toBeUndefined();
    });

    test("seeds the preview workspace of a preview target", async () => {
      fs.mkdirSync(path.join(testDir, "seed/data"), { recursive: true });
      await setupTarget({
        kind: "preview",
        workspaceName: "my-app",
        region: "us-west",
        dir: ".",
        force: false,
        outputDir: testDir,
        gitRunner: () => "origin/main",
        loadConfigName: async () => "my-app",
        loadConfigId: async () => undefined,
        seed: { datasets: [] },
        loadSeedSettings: seedSettings(),
      });

      const wf = fs.readFileSync(
        path.join(testDir, ".github/workflows/tailor-my-app-preview.yml"),
        "utf-8",
      );
      expect(wf).toContain("pnpm exec tailor seed apply --truncate --yes");
      expect(readLock(testDir)?.targets[0]?.inputs.seed).toEqual({ datasets: [] });
    });

    test.each([
      {
        name: "a config without seedPlugin",
        loadSeedSettings: async () => null,
        datasets: [],
        message:
          "--seed needs seedPlugin from @tailor-platform/sdk/plugin/seed in tailor.config.ts. " +
          "Fix seedPlugin, or regenerate the workflow without --seed.",
      },
      {
        name: "a seedPlugin without machineUserName",
        loadSeedSettings: seedSettings({ machineUserName: undefined }),
        datasets: [],
        message: "--seed needs the machineUserName option of seedPlugin",
      },
      {
        name: "an unknown dataset",
        loadSeedSettings: seedSettings({ datasets: { preview: ["cogs"] } }),
        dirs: ["cogs"],
        datasets: ["typo"],
        message: 'Unknown seed dataset "typo". Datasets in seedPlugin options: preview.',
      },
      {
        name: "an invalid dataset name",
        loadSeedSettings: seedSettings(),
        datasets: ["bad name"],
        message: '"bad name" is not a valid dataset name.',
      },
      {
        name: "a seedPlugin without distPath",
        loadSeedSettings: seedSettings({ dataDir: undefined }),
        datasets: [],
        message: "--seed needs the distPath option of seedPlugin",
      },
      {
        name: "a missing seed data directory without datasets",
        loadSeedSettings: seedSettings(),
        datasets: [],
        message: "Seed data directory not found:",
      },
      {
        name: "a dataset directory spelled in another case",
        loadSeedSettings: seedSettings(),
        dirs: ["preview"],
        datasets: ["Preview"],
        message: 'Unknown seed dataset "Preview".',
      },
      {
        name: "a configured dataset that lists a missing directory",
        loadSeedSettings: seedSettings({ datasets: { preview: ["cogs", "missing"] } }),
        dirs: ["cogs"],
        datasets: ["preview"],
        message: `Dataset "preview" in seedPlugin options lists "missing", but ${path.join(testDir, "seed/data/missing")} is not a directory`,
      },
    ])(
      "rejects $name before writing anything",
      async ({ loadSeedSettings, dirs, datasets, message }) => {
        for (const dir of dirs ?? []) {
          fs.mkdirSync(path.join(testDir, "seed/data", dir), { recursive: true });
        }
        await expect(
          setupTarget(
            baseOptions({ workspaceName: "my-app", seed: { datasets }, loadSeedSettings }),
          ),
        ).rejects.toThrow(message);

        expect(fs.existsSync(path.join(testDir, ".github/workflows/tailor-my-app.yml"))).toBe(
          false,
        );
        expect(readLock(testDir)).toBeNull();
      },
    );

    test("rejects seeding a target that deploys several apps", async () => {
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({ private: true, devDependencies: { "@tailor-platform/sdk": "1.0.0" } }),
      );
      for (const dir of ["apps/erp/backend", "apps/users/backend"]) {
        fs.mkdirSync(path.join(testDir, dir), { recursive: true });
        fs.writeFileSync(
          path.join(testDir, dir, "tailor.config.ts"),
          `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "app" });\n`,
        );
      }

      await expect(
        setupTarget(
          baseOptions({
            workspaceName: "erp",
            dir: ["apps/erp/backend", "apps/users/backend"],
            seed: { datasets: [] },
            loadSeedSettings: seedSettings(),
          }),
        ),
      ).rejects.toThrow("--seed is supported only for a target that deploys one app.");
    });
  });

  describe("--paths", () => {
    const writeApp = (dir: string): void => {
      fs.mkdirSync(path.join(testDir, dir), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, dir, "tailor.config.ts"),
        `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "app" });\n`,
      );
    };

    test("extends the workflow's change detection and is recorded in the lock", async () => {
      writeApp("apps/erp/backend");

      await setupTarget(
        baseOptions({
          workspaceName: "erp",
          dir: "apps/erp/backend",
          extraPaths: ["apps/erp/frontend/**", "pnpm-lock.yaml"],
          loadHasMigrations: async () => false,
          loadHasSeeds: async () => false,
        }),
      );

      const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-erp.yml"), "utf-8");
      expect(wf).toContain(
        "path-patterns: |\n            apps/erp/backend/**\n            .github/workflows/tailor-erp.yml\n            apps/erp/frontend/**\n            pnpm-lock.yaml\n",
      );
      expect(readLock(testDir)?.targets[0]?.inputs.paths).toEqual([
        "apps/erp/frontend/**",
        "pnpm-lock.yaml",
      ]);
    });

    test("is rejected for an app at the repository root, whose workflow already runs on every change", async () => {
      await expect(
        setupTarget(baseOptions({ workspaceName: "erp", dir: ".", extraPaths: ["modules/**"] })),
      ).rejects.toThrow(/--paths has no effect when --dir is the repository root/);
    });

    test("accepts literal path characters such as the @ of a scoped package", async () => {
      writeApp("apps/erp/backend");

      await setupTarget(
        baseOptions({
          workspaceName: "erp",
          dir: "apps/erp/backend",
          extraPaths: ["packages/@scope/**"],
          loadHasMigrations: async () => false,
          loadHasSeeds: async () => false,
        }),
      );

      expect(readLock(testDir)?.targets[0]?.inputs.paths).toEqual(["packages/@scope/**"]);
    });

    test.each([
      ["a workflow expression", "${{ github.token }}"],
      ["a line break", "modules/**\nsha-head: x"],
      ["surrounding whitespace", " modules/** "],
      ["a C1 control character (NEL)", "modules/**\u0085sha-head: x"],
      ["a Unicode line separator", "modules/**\u2028sha-head: x"],
      ["a Unicode paragraph separator", "modules/**\u2029sha-head: x"],
    ])("rejects a pattern containing %s", async (_label, pattern) => {
      writeApp("apps/erp/backend");

      await expect(
        setupTarget(
          baseOptions({ workspaceName: "erp", dir: "apps/erp/backend", extraPaths: [pattern] }),
        ),
      ).rejects.toThrow(/Invalid --paths/);
    });

    test.each([
      "apps/[id]/**",
      "apps/?/**",
      "apps/{a,b}/**",
      "apps/a+/**",
      "apps/(group)/**",
      "apps\\a/**",
    ])(
      "rejects %s, whose glob characters the change detection does not support",
      async (pattern) => {
        writeApp("apps/erp/backend");

        await expect(
          setupTarget(
            baseOptions({ workspaceName: "erp", dir: "apps/erp/backend", extraPaths: [pattern] }),
          ),
        ).rejects.toThrow(/Invalid --paths .*only `\*`, `\*\*`, and a leading `!`/);
      },
    );
  });

  describe("multiple --dir", () => {
    const dirs = ["apps/erp/backend", "apps/users/backend"];
    const writeApp = (dir: string): void => {
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({ private: true, devDependencies: { "@tailor-platform/sdk": "1.0.0" } }),
      );
      fs.mkdirSync(path.join(testDir, dir), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, dir, "tailor.config.ts"),
        `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "${path.basename(path.dirname(dir))}" });\n`,
      );
    };

    test("deploys every app from one workflow and records each app directory in the lock", async () => {
      dirs.forEach(writeApp);

      await setupTarget(
        baseOptions({
          workspaceName: "erp",
          dir: dirs,
          loadHasMigrations: async (configPath) => configPath.includes("/users/"),
          loadHasSeeds: async () => false,
        }),
      );

      const wf = fs.readFileSync(path.join(testDir, ".github/workflows/tailor-erp.yml"), "utf-8");
      expect(wf).toContain(
        "TAILOR_PLATFORM_SDK_CONFIG_PATH: apps/erp/backend/tailor.config.ts,apps/users/backend/tailor.config.ts",
      );
      expect(readLock(testDir)?.targets[0]?.inputs).toMatchObject({
        dir: ".",
        apps: [
          { dir: "apps/erp/backend", migrationDriftCheck: false, seedValidate: false },
          { dir: "apps/users/backend", migrationDriftCheck: true, seedValidate: false },
        ],
      });
    });

    test("requires @tailor-platform/sdk in the root package.json, because the multi-config run starts from the repository root", async () => {
      dirs.forEach(writeApp);
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({ name: "repo", private: true, devDependencies: { oxfmt: "1.0.0" } }),
      );

      await expect(setupTarget(baseOptions({ workspaceName: "erp", dir: dirs }))).rejects.toThrow(
        /Add @tailor-platform\/sdk to the dependencies of package\.json/,
      );
    });

    test("rejects --migration-test, which supports a single app directory only", async () => {
      dirs.forEach(writeApp);

      await expect(
        setupTarget(
          baseOptions({
            workspaceName: "erp",
            dir: dirs,
            loadHasMigrations: async () => true,
            migrationTest: true,
          }),
        ),
      ).rejects.toThrow(/--migration-test is not supported with several --dir/);
    });

    test("requires --name, because no single config names a workflow that deploys several apps", async () => {
      dirs.forEach(writeApp);

      await expect(
        setupTarget(baseOptions({ workspaceName: undefined, dir: dirs })),
      ).rejects.toThrow(/--name is required when --dir is given more than once/);
    });

    test("previews the ERD of every namespace owned by each app, recording the owner in the lock", async () => {
      dirs.forEach(writeApp);

      await setupTarget(
        baseOptions({
          workspaceName: "erp",
          dir: dirs,
          erdPreview: true,
          loadErdNamespaces: async (configPath) =>
            configPath.includes("/erp/") ? ["erp"] : ["users", "audit"],
          loadHasMigrations: async () => false,
          loadHasSeeds: async () => false,
        }),
      );

      const inputs = readLock(testDir)?.targets[0]?.inputs;
      expect(inputs?.erdNamespaces).toEqual(["erp", "users", "audit"]);
      expect(inputs?.apps?.map((app) => [app.dir, app.erdNamespaces])).toEqual([
        ["apps/erp/backend", ["erp"]],
        ["apps/users/backend", ["users", "audit"]],
      ]);
    });

    test("rejects --erd-preview when two apps own the same TailorDB namespace", async () => {
      dirs.forEach(writeApp);

      await expect(
        setupTarget(
          baseOptions({
            workspaceName: "erp",
            dir: dirs,
            erdPreview: true,
            loadErdNamespaces: async () => ["shared"],
          }),
        ),
      ).rejects.toThrow(
        /TailorDB namespace "shared" is owned by both "apps\/erp\/backend" and "apps\/users\/backend"/,
      );
    });

    test("resolves . and .. segments, so an app named twice through them is rejected", async () => {
      dirs.forEach(writeApp);

      await expect(
        setupTarget(
          baseOptions({
            workspaceName: "erp",
            dir: ["apps/erp/backend", "apps/users/../erp/./backend"],
          }),
        ),
      ).rejects.toThrow(/"apps\/erp\/backend" and "apps\/erp\/backend" map to the same step id/);
    });

    test("rejects two --dir values that reach the same config through a symbolic link", async () => {
      writeApp("apps/erp/backend");
      fs.symlinkSync(path.join(testDir, "apps/erp"), path.join(testDir, "apps/alias"));

      await expect(
        setupTarget(
          baseOptions({ workspaceName: "erp", dir: ["apps/erp/backend", "apps/alias/backend"] }),
        ),
      ).rejects.toThrow(/"apps\/erp\/backend" and "apps\/alias\/backend" are the same app/);
    });

    test("rejects directories whose generated step ids would collide", async () => {
      ["apps/a-b", "apps/a/b"].forEach(writeApp);

      await expect(
        setupTarget(baseOptions({ workspaceName: "erp", dir: ["apps/a-b", "apps/a/b"] })),
      ).rejects.toThrow(/"apps\/a-b" and "apps\/a\/b" map to the same step id suffix/);
    });

    test("keeps a user step anchored after the single-directory generate check when a second --dir is added", async () => {
      dirs.forEach(writeApp);
      const noPlugins = { loadHasMigrations: async () => false, loadHasSeeds: async () => false };
      await setupTarget(
        baseOptions({ workspaceName: "erp", dir: "apps/erp/backend", ...noPlugins }),
      );
      const wf = path.join(testDir, ".github/workflows/tailor-erp.yml");
      fs.writeFileSync(
        wf,
        fs
          .readFileSync(wf, "utf-8")
          .replace(
            "          working-directory: apps/erp/backend\n      - id: tailor-drift-check",
            "          working-directory: apps/erp/backend\n      - name: Build frontend\n        run: echo build\n      - id: tailor-drift-check",
          ),
      );

      await setupTarget(baseOptions({ workspaceName: "erp", dir: dirs, ...noPlugins }));

      const steps = (parseYAML(fs.readFileSync(wf, "utf-8")) as GeneratedWorkflow).jobs[
        "tailor-plan"
      ]?.steps.map((step) => step.id ?? step.name);
      expect(steps).toContain("Build frontend");
      expect(steps).toContain("tailor-generate-check-apps-users-backend");
      expect(steps).not.toContain("tailor-generate-check");
    });

    test("records the app id of every config in the lock", async () => {
      dirs.forEach(writeApp);

      await setupTarget(
        baseOptions({
          workspaceName: "erp",
          dir: dirs,
          loadHasMigrations: async () => false,
          loadHasSeeds: async () => false,
        }),
      );

      expect(Object.keys(readLock(testDir)?.appIds ?? {})).toEqual([
        "apps/erp/backend/tailor.config.ts",
        "apps/users/backend/tailor.config.ts",
      ]);
    });
  });
});
