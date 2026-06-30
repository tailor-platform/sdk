import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkGitHub, findTargetDrift, resolveWithinRoot, type TargetState } from "./check";
import { setupTarget, type BranchSetupOptions } from "./generate";
import { LOCK_VERSION, type LockTarget, hashContent, writeLock } from "./lock";
import { TEMPLATE_VERSION } from "./templates";

const baseTarget = (overrides: Partial<LockTarget> = {}): LockTarget => ({
  kind: "branch",
  workspaceName: "my-app",
  file: ".github/workflows/tailor-my-app.yml",
  templateVersion: TEMPLATE_VERSION,
  inputs: {
    branch: "main",
    tagPattern: null,
    environment: "my-app",
    dir: ".",
    packageManager: "pnpm",
  },
  generatedIds: [],
  ejectedIds: [],
  contentHash: "sha256:abc",
  ...overrides,
});

const cleanState = (overrides: Partial<TargetState> = {}): TargetState => ({
  fileExists: true,
  currentHash: "sha256:abc",
  configExists: true,
  defaultBranch: "main",
  templateVersion: TEMPLATE_VERSION,
  erdNamespaces: ["tailordb"],
  ...overrides,
});

describe("findTargetDrift", () => {
  test("no findings when in sync", () => {
    expect(findTargetDrift(baseTarget(), cleanState())).toEqual([]);
  });

  test("reports a missing file", () => {
    const findings = findTargetDrift(baseTarget(), cleanState({ fileExists: false }));
    expect(findings.map((f) => f.rule)).toEqual(["missing-file"]);
  });

  test("reports a hand-edited file via hash mismatch", () => {
    const findings = findTargetDrift(baseTarget(), cleanState({ currentHash: "sha256:zzz" }));
    expect(findings.map((f) => f.rule)).toEqual(["hand-edit"]);
  });

  test("does not report hand-edit when the file is missing", () => {
    const findings = findTargetDrift(
      baseTarget(),
      cleanState({ fileExists: false, currentHash: null }),
    );
    expect(findings.map((f) => f.rule)).toEqual(["missing-file"]);
  });

  test("reports an outdated template version", () => {
    const findings = findTargetDrift(
      baseTarget({ templateVersion: TEMPLATE_VERSION - 1 }),
      cleanState(),
    );
    expect(findings.map((f) => f.rule)).toEqual(["template-version"]);
  });

  test("reports a missing config under the recorded dir", () => {
    const findings = findTargetDrift(baseTarget(), cleanState({ configExists: false }));
    expect(findings.map((f) => f.rule)).toEqual(["config-dir"]);
  });

  test("reports a default-branch drift for branch targets", () => {
    const findings = findTargetDrift(baseTarget(), cleanState({ defaultBranch: "develop" }));
    expect(findings.map((f) => f.rule)).toEqual(["default-branch"]);
  });

  test("skips default-branch drift for tag targets", () => {
    const findings = findTargetDrift(
      baseTarget({ kind: "tag", inputs: { ...baseTarget().inputs, branch: null } }),
      cleanState({ defaultBranch: "develop" }),
    );
    expect(findings).toEqual([]);
  });

  test("skips default-branch drift when the branch cannot be detected", () => {
    const findings = findTargetDrift(baseTarget(), cleanState({ defaultBranch: null }));
    expect(findings).toEqual([]);
  });

  test("skips default-branch drift when branch was explicitly set", () => {
    const findings = findTargetDrift(
      baseTarget({
        inputs: { ...baseTarget().inputs, branch: "staging", branchAutoDetected: false },
      }),
      cleanState({ defaultBranch: "main" }),
    );
    expect(findings).toEqual([]);
  });

  test("reports default-branch drift when branchAutoDetected is true", () => {
    const findings = findTargetDrift(
      baseTarget({
        inputs: { ...baseTarget().inputs, branch: "main", branchAutoDetected: true },
      }),
      cleanState({ defaultBranch: "develop" }),
    );
    expect(findings.map((f) => f.rule)).toEqual(["default-branch"]);
  });

  test("reports default-branch drift when branchAutoDetected is undefined (legacy lock)", () => {
    const target = baseTarget();
    delete target.inputs.branchAutoDetected;
    const findings = findTargetDrift(target, cleanState({ defaultBranch: "develop" }));
    expect(findings.map((f) => f.rule)).toEqual(["default-branch"]);
  });

  test("reports ERD namespace drift when preview namespaces changed", () => {
    const findings = findTargetDrift(
      baseTarget({
        inputs: {
          ...baseTarget().inputs,
          erdPreview: true,
          erdNamespaces: ["tailordb"],
        },
      }),
      cleanState({ erdNamespaces: ["tailordb", "analyticsdb"] }),
    );
    expect(findings.map((f) => f.rule)).toEqual(["erd-namespaces"]);
  });

  test("does not report ERD namespace drift when the config is missing", () => {
    const findings = findTargetDrift(
      baseTarget({
        inputs: {
          ...baseTarget().inputs,
          erdPreview: true,
          erdNamespaces: ["tailordb"],
        },
      }),
      cleanState({ configExists: false, erdNamespaces: null }),
    );
    expect(findings.map((f) => f.rule)).toEqual(["config-dir"]);
  });

  test("accumulates multiple findings", () => {
    const findings = findTargetDrift(
      baseTarget({ templateVersion: TEMPLATE_VERSION - 1 }),
      cleanState({ currentHash: "sha256:zzz", defaultBranch: "develop" }),
    );
    expect(findings.map((f) => f.rule).toSorted()).toEqual(
      ["default-branch", "hand-edit", "template-version"].toSorted(),
    );
  });

  test("reports migration-drift when migrations were added", () => {
    const findings = findTargetDrift(
      baseTarget({ inputs: { ...baseTarget().inputs, migrationDriftCheck: false } }),
      cleanState({ hasMigrations: true }),
    );
    expect(findings.map((f) => f.rule)).toEqual(["migration-drift"]);
    expect(findings[0]?.message).toMatch(/plan job/);
  });

  test("reports seed-validate when seed plugin was added", () => {
    const findings = findTargetDrift(
      baseTarget({ inputs: { ...baseTarget().inputs, seedValidate: false } }),
      cleanState({ hasSeeds: true }),
    );
    expect(findings.map((f) => f.rule)).toEqual(["seed-validate"]);
    expect(findings[0]?.message).toMatch(/plan job/);
  });
});

describe("resolveWithinRoot", () => {
  const dir = path.join(os.tmpdir(), `rwr-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  beforeEach(() => fs.mkdirSync(dir, { recursive: true }));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("returns the joined path for a normal relative path", () => {
    expect(resolveWithinRoot(dir, "a/b.yml")).toBe(path.join(dir, "a/b.yml"));
  });

  test("rejects an absolute path", () => {
    expect(resolveWithinRoot(dir, "/etc/passwd")).toBeNull();
  });

  test("rejects a `..` traversal", () => {
    expect(resolveWithinRoot(dir, "../escape.yml")).toBeNull();
  });

  test("rejects a symlink that escapes the repo root", () => {
    const outside = path.join(
      os.tmpdir(),
      `outside-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.writeFileSync(outside, "secret\n");
    fs.symlinkSync(outside, path.join(dir, "link.yml"));
    try {
      expect(resolveWithinRoot(dir, "link.yml")).toBeNull();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test("allows a symlink that stays within the repo root", () => {
    fs.writeFileSync(path.join(dir, "real.yml"), "ok\n");
    fs.symlinkSync(path.join(dir, "real.yml"), path.join(dir, "inside.yml"));
    expect(resolveWithinRoot(dir, "inside.yml")).toBe(path.join(dir, "inside.yml"));
  });
});

describe("checkGitHub (integration)", () => {
  const testDir = path.join(
    os.tmpdir(),
    `setup-gh-check-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  const setupOptions = (overrides: Partial<BranchSetupOptions> = {}): BranchSetupOptions => ({
    kind: "branch",
    erdPreview: false,
    dir: ".",
    force: false,
    outputDir: testDir,
    branch: "main",
    gitRunner: () => "origin/main",
    loadConfigName: async () => "my-app",
    ...overrides,
  });

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    fs.writeFileSync(
      path.join(testDir, "tailor.config.ts"),
      `import { defineConfig } from "@tailor-platform/sdk";\nexport default defineConfig({ name: "my-app" });\n`,
      "utf-8",
    );
  });

  afterEach(() => fs.rmSync(testDir, { recursive: true, force: true }));

  const wfPath = (): string => path.join(testDir, ".github/workflows/tailor-my-app.yml");

  // ci: true skips the WORKSPACE_ID env check so these tests focus on drift detection.
  const check = (gitRunner: () => string = () => "origin/main") =>
    checkGitHub({ outputDir: testDir, ci: true, gitRunner });

  test("passes for a freshly generated target", async () => {
    await setupTarget(setupOptions({ workspaceName: "my-app" }));
    await expect(check()).resolves.toBeUndefined();
  });

  test("passes after --force regeneration following a hand edit", async () => {
    await setupTarget(setupOptions({ workspaceName: "my-app" }));
    fs.appendFileSync(wfPath(), "\n# hand edit\n");
    // --force should overwrite edits and update the lock's contentHash
    await setupTarget(setupOptions({ workspaceName: "my-app", force: true }));
    await expect(check()).resolves.toBeUndefined();
  });

  test("errors when no lock exists", async () => {
    await expect(checkGitHub({ outputDir: testDir })).rejects.toThrow(/No managed workflows/);
  });

  test("detects a hand-edited workflow file", async () => {
    await setupTarget(setupOptions({ workspaceName: "my-app" }));
    fs.appendFileSync(wfPath(), "\n# hand edit\n");
    await expect(check()).rejects.toThrow(/drift/);
  });

  test("detects a default-branch change for auto-detected branch", async () => {
    await setupTarget(
      setupOptions({ workspaceName: "my-app", branch: undefined, gitRunner: () => "origin/main" }),
    );
    await expect(check(() => "origin/develop")).rejects.toThrow(/drift/);
  });

  test("skips default-branch drift when branch was explicitly set", async () => {
    await setupTarget(setupOptions({ workspaceName: "my-app", branch: "staging" }));
    await expect(check()).resolves.toBeUndefined();
  });

  test("detects a missing config under the recorded dir", async () => {
    await setupTarget(setupOptions({ workspaceName: "my-app" }));
    fs.rmSync(path.join(testDir, "tailor.config.ts"));
    await expect(check()).rejects.toThrow(/drift/);
  });

  test("throws when WORKSPACE_ID is unset and a deploying target exists (local mode)", async () => {
    await setupTarget(setupOptions({ workspaceName: "my-app" }));
    const saved = process.env["TAILOR_PLATFORM_WORKSPACE_ID"];
    delete process.env["TAILOR_PLATFORM_WORKSPACE_ID"];
    try {
      await expect(
        checkGitHub({ outputDir: testDir, gitRunner: () => "origin/main", ci: false }),
      ).rejects.toThrow(/TAILOR_PLATFORM_WORKSPACE_ID/);
    } finally {
      if (saved !== undefined) process.env["TAILOR_PLATFORM_WORKSPACE_ID"] = saved;
    }
  });

  test("skips WORKSPACE_ID check in CI mode", async () => {
    await setupTarget(setupOptions({ workspaceName: "my-app" }));
    const saved = process.env["TAILOR_PLATFORM_WORKSPACE_ID"];
    delete process.env["TAILOR_PLATFORM_WORKSPACE_ID"];
    try {
      await expect(
        checkGitHub({ outputDir: testDir, gitRunner: () => "origin/main", ci: true }),
      ).resolves.toBeUndefined();
    } finally {
      if (saved !== undefined) process.env["TAILOR_PLATFORM_WORKSPACE_ID"] = saved;
    }
  });

  test("skips WORKSPACE_ID check when only preview targets exist (local mode)", async () => {
    await setupTarget({
      kind: "preview",
      workspaceName: "my-app",
      region: "us-west",
      dir: ".",
      force: false,
      outputDir: testDir,
      gitRunner: () => "origin/main",
      loadConfigName: async () => "my-app",
    });
    const saved = process.env["TAILOR_PLATFORM_WORKSPACE_ID"];
    delete process.env["TAILOR_PLATFORM_WORKSPACE_ID"];
    try {
      await expect(
        checkGitHub({ outputDir: testDir, gitRunner: () => "origin/main", ci: false }),
      ).resolves.toBeUndefined();
    } finally {
      if (saved !== undefined) process.env["TAILOR_PLATFORM_WORKSPACE_ID"] = saved;
    }
  });

  test("detects ERD preview namespace drift", async () => {
    await setupTarget(
      setupOptions({
        workspaceName: "my-app",
        erdPreview: true,
        loadErdNamespaces: async () => ["tailordb"],
      }),
    );
    await expect(
      checkGitHub({
        outputDir: testDir,
        ci: true,
        gitRunner: () => "origin/main",
        loadErdNamespaces: async () => ["tailordb", "analyticsdb"],
      }),
    ).rejects.toThrow(/drift/);
  });

  const lockTarget = (file: string): LockTarget => ({
    kind: "branch",
    workspaceName: "my-app",
    file,
    templateVersion: TEMPLATE_VERSION,
    inputs: {
      branch: "main",
      tagPattern: null,
      environment: "my-app",
      dir: ".",
      packageManager: "pnpm",
      erdPreview: false,
    },
    generatedIds: [],
    ejectedIds: [],
    contentHash: "sha256:abc",
  });

  test("reports drift instead of reading outside the repo on a traversing lock path", async () => {
    writeLock(testDir, { version: LOCK_VERSION, targets: [lockTarget("../escape.yml")] });
    await expect(check()).rejects.toThrow(/drift/);
  });

  test("does not crash when the recorded file path is a directory", async () => {
    const file = ".github/workflows/tailor-my-app.yml";
    writeLock(testDir, { version: LOCK_VERSION, targets: [lockTarget(file)] });
    fs.mkdirSync(path.join(testDir, file), { recursive: true });
    await expect(check()).rejects.toThrow(/drift/);
  });

  test("coordinate targets do not report config-dir drift even when no config exists at dir", async () => {
    // Write a coordinator workflow file and a lock with only that coordinate target.
    const wfFile = ".github/workflows/tailor-coordinate-main.yml";
    const wfAbsPath = path.join(testDir, wfFile);
    fs.mkdirSync(path.dirname(wfAbsPath), { recursive: true });
    const wfContent = "# coordinator\n";
    fs.writeFileSync(wfAbsPath, wfContent);
    writeLock(testDir, {
      version: LOCK_VERSION,
      targets: [
        {
          kind: "coordinate",
          workspaceName: "main",
          file: wfFile,
          templateVersion: TEMPLATE_VERSION,
          inputs: {
            branch: "main",
            tagPattern: null,
            environment: "main",
            dir: ".",
            packageManager: "pnpm",
          },
          generatedIds: [],
          ejectedIds: [],
          contentHash: hashContent(wfContent),
        },
      ],
    });
    // Remove the root config to confirm coordinators skip the config probe.
    fs.rmSync(path.join(testDir, "tailor.config.ts"));
    await expect(check()).resolves.toBeUndefined();
  });
});
