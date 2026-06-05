import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildFiles, writeFiles } from "./github";
import { detectPackageManager, renderDeploy } from "./templates";

describe("detectPackageManager", () => {
  const testDir = path.join("/tmp", `detect-pm-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("detects pnpm from pnpm-lock.yaml", () => {
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(testDir)).toBe("pnpm");
  });

  test("detects yarn from yarn.lock", () => {
    fs.writeFileSync(path.join(testDir, "yarn.lock"), "");
    expect(detectPackageManager(testDir)).toBe("yarn");
  });

  test("defaults to npm when no lockfile found", () => {
    expect(detectPackageManager(testDir)).toBe("npm");
  });

  test("detects npm from package-lock.json", () => {
    fs.writeFileSync(path.join(testDir, "package-lock.json"), "");
    expect(detectPackageManager(testDir)).toBe("npm");
  });

  test("detects bun from bun.lockb", () => {
    fs.writeFileSync(path.join(testDir, "bun.lockb"), "");
    expect(detectPackageManager(testDir)).toBe("bun");
  });

  test("detects bun from bun.lock", () => {
    fs.writeFileSync(path.join(testDir, "bun.lock"), "");
    expect(detectPackageManager(testDir)).toBe("bun");
  });

  test("prefers pnpm when multiple lockfiles exist", () => {
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
    fs.writeFileSync(path.join(testDir, "yarn.lock"), "");
    expect(detectPackageManager(testDir)).toBe("pnpm");
  });
});

describe("renderDeploy", () => {
  const baseParams = {
    workspaceName: "my-app",
    workspaceRegion: "asia-northeast",
    organizationId: "org-123",
    folderId: "folder-456",
    packageManager: "pnpm" as const,
  };

  test("references the composite action", () => {
    const content = renderDeploy(baseParams);
    expect(content).toMatch(/uses: tailor-platform\/actions\/deploy@[a-f0-9]+ # v\d+\.\d+\.\d+/);
  });

  test("includes setup steps in correct order", () => {
    const content = renderDeploy(baseParams);
    const checkoutIndex = content.indexOf("uses: actions/checkout@");
    const setupIndex = content.indexOf("uses: pnpm/action-setup@");
    const actionIndex = content.indexOf("uses: tailor-platform/actions/deploy@");
    expect(checkoutIndex).toBeGreaterThan(-1);
    expect(setupIndex).toBeGreaterThan(checkoutIndex);
    expect(actionIndex).toBeGreaterThan(setupIndex);
  });

  test("pins action versions with SHA and version comment", () => {
    const content = renderDeploy(baseParams);
    expect(content).toMatch(/uses: actions\/checkout@[a-f0-9]+ # v\d+\.\d+\.\d+/);
    expect(content).toMatch(/uses: pnpm\/action-setup@[a-f0-9]+ # v\d+\.\d+\.\d+/);
    expect(content).toMatch(/uses: actions\/setup-node@[a-f0-9]+ # v\d+\.\d+\.\d+/);
    expect(content).toMatch(/uses: tailor-platform\/actions\/deploy@[a-f0-9]+ # v\d+\.\d+\.\d+/);
  });

  test("generates pnpm setup steps", () => {
    const content = renderDeploy({ ...baseParams, packageManager: "pnpm" });
    expect(content).toContain("pnpm/action-setup@");
    expect(content).toContain("cache: pnpm");
    expect(content).toContain("pnpm install --frozen-lockfile");
  });

  test("generates yarn setup steps", () => {
    const content = renderDeploy({ ...baseParams, packageManager: "yarn" });
    expect(content).not.toContain("pnpm");
    expect(content).toContain("cache: yarn");
    expect(content).toContain("yarn install --frozen-lockfile");
  });

  test("generates npm setup steps", () => {
    const content = renderDeploy({ ...baseParams, packageManager: "npm" });
    expect(content).not.toContain("pnpm");
    expect(content).not.toContain("yarn");
    expect(content).toContain("cache: npm");
    expect(content).toContain("npm ci");
  });

  test("generates bun setup steps", () => {
    const content = renderDeploy({ ...baseParams, packageManager: "bun" });
    expect(content).not.toContain("pnpm");
    expect(content).not.toContain("yarn");
    expect(content).not.toContain("npm ci");
    expect(content).toContain("oven-sh/setup-bun@");
    expect(content).toContain("bun install --frozen-lockfile");
  });

  test("passes workspace inputs", () => {
    const content = renderDeploy(baseParams);
    expect(content).toContain("workspace-name: my-app");
    expect(content).toContain("workspace-region: asia-northeast");
    expect(content).toContain("organization-id: org-123");
    expect(content).toContain("folder-id: folder-456");
  });

  test("passes secrets as action inputs", () => {
    const content = renderDeploy(baseParams);
    expect(content).toContain("platform-client-id: ${{ secrets.PLATFORM_MACHINE_USER_CLIENT_ID }}");
    expect(content).toContain(
      "platform-client-secret: ${{ secrets.PLATFORM_MACHINE_USER_CLIENT_SECRET }}",
    );
  });

  test("does not include working-directory when omitted", () => {
    expect(renderDeploy(baseParams)).not.toContain("working-directory");
  });

  test("includes working-directory when provided", () => {
    expect(renderDeploy({ ...baseParams, workingDirectory: "apps/foo" })).toContain(
      "working-directory: apps/foo",
    );
  });

  test("preserves $ characters in parameter values", () => {
    const content = renderDeploy({
      ...baseParams,
      workspaceName: "test$&end",
    });
    expect(content).toContain("workspace-name: test$&end");
  });

  test("parameterizes concurrency group with workspace name", () => {
    const content = renderDeploy(baseParams);
    expect(content).toContain("group: tailor-my-app-");
  });

  test("strips plan job by default", () => {
    const content = renderDeploy(baseParams);
    expect(content).not.toContain("tailor-platform/actions/plan@");
    expect(content).not.toContain("TAILOR_PLATFORM_WORKSPACE_ID");
    expect(content).not.toContain("__PLAN_JOB_START__");
    expect(content).not.toContain("__PLAN_JOB_END__");
    expect(content).toContain("tailor-platform/actions/deploy@");
  });

  test("includes plan job when withPlan is true", () => {
    const content = renderDeploy({ ...baseParams, withPlan: true });
    expect(content).toContain("tailor-platform/actions/plan@");
    expect(content).toContain("workspace-id: ${{ vars.TAILOR_PLATFORM_WORKSPACE_ID }}");
    expect(content).toContain("github-token: ${{ secrets.GITHUB_TOKEN }}");
    expect(content).toContain("tailor-platform/actions/deploy@");
    expect(content).not.toContain("__PLAN_JOB_START__");
    expect(content).not.toContain("__PLAN_JOB_END__");
  });

  test("includes setup steps in both plan and deploy jobs when withPlan is true", () => {
    const content = renderDeploy({ ...baseParams, withPlan: true });
    const matches = content.match(/uses: pnpm\/action-setup@/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  test("propagates working-directory to plan job when withPlan is true", () => {
    const content = renderDeploy({
      ...baseParams,
      withPlan: true,
      workingDirectory: "apps/foo",
    });
    const matches = content.match(/working-directory: apps\/foo/g) ?? [];
    expect(matches).toHaveLength(2);
  });
});

describe("buildFiles", () => {
  const testDir = path.join("/tmp", `build-files-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, "pnpm-lock.yaml"), "");
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("generates only the caller workflow file", () => {
    const files = buildFiles({
      workspaceName: "my-app",
      workspaceRegion: "asia-northeast",
      organizationId: "org-123",
      folderId: "folder-456",
      dir: ".",
      outputDir: testDir,
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe(path.join(testDir, ".github/workflows/tailor-my-app.yml"));
  });

  test("detects package manager from project directory", () => {
    const files = buildFiles({
      workspaceName: "my-app",
      workspaceRegion: "asia-northeast",
      organizationId: "org-123",
      folderId: "folder-456",
      dir: ".",
      outputDir: testDir,
    });
    expect(files[0]!.content).toContain("pnpm/action-setup");
  });

  test("detects package manager from repo root when dir is a subdirectory", () => {
    const subDir = path.join(testDir, "apps/foo");
    fs.mkdirSync(subDir, { recursive: true });
    const files = buildFiles({
      workspaceName: "my-app",
      workspaceRegion: "asia-northeast",
      organizationId: "org-123",
      folderId: "folder-456",
      dir: "apps/foo",
      outputDir: testDir,
    });
    expect(files[0]!.content).toContain("pnpm/action-setup");
  });
});

describe("writeFiles", () => {
  const testDir = path.join("/tmp", `setup-github-test-${Date.now()}`);

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test("writes files that do not exist", () => {
    const filePath = path.join(testDir, "workflow.yml");
    const result = writeFiles([{ path: filePath, content: "test content" }]);
    expect(result.written).toContain(filePath);
    expect(result.skipped).toHaveLength(0);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("test content");
  });

  test("skips files that already exist", () => {
    const filePath = path.join(testDir, "existing.yml");
    fs.writeFileSync(filePath, "original content");
    const result = writeFiles([{ path: filePath, content: "new content" }]);
    expect(result.skipped).toContain(filePath);
    expect(result.written).toHaveLength(0);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("original content");
  });

  test("creates parent directories as needed", () => {
    const filePath = path.join(testDir, "deep/nested/dir/file.yml");
    const result = writeFiles([{ path: filePath, content: "nested" }]);
    expect(result.written).toContain(filePath);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("nested");
  });

  test("handles mixed existing and new files", () => {
    const existingPath = path.join(testDir, "existing.yml");
    const newPath = path.join(testDir, "new.yml");
    fs.writeFileSync(existingPath, "original");
    const result = writeFiles([
      { path: existingPath, content: "updated" },
      { path: newPath, content: "brand new" },
    ]);
    expect(result.written).toContain(newPath);
    expect(result.skipped).toContain(existingPath);
  });
});
