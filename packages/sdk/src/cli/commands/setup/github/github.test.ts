import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFiles, writeFiles } from "./github";

describe("buildFiles", () => {
  const baseOptions = {
    workspaceName: "my-app",
    workspaceRegion: "asia-northeast",
    organizationId: "org-123",
    folderId: "folder-456",
    dir: ".",
    outputDir: "/tmp/test-project",
  };

  function getDeployContent(options = baseOptions): string {
    const files = buildFiles(options);
    return files.find((f) => f.path.includes("workflows/deploy-"))!.content;
  }

  it("generates only the caller workflow file", () => {
    const files = buildFiles(baseOptions);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe(
      path.join(baseOptions.outputDir, ".github/workflows/deploy-my-app.yml"),
    );
  });

  it("references the composite action", () => {
    const content = getDeployContent();
    expect(content).toContain("uses: tailor-platform/actions/deploy@v1");
  });

  it("includes setup steps before action", () => {
    const content = getDeployContent();
    const checkoutIndex = content.indexOf("uses: actions/checkout@v4");
    const pnpmIndex = content.indexOf("uses: pnpm/action-setup@v4");
    const nodeIndex = content.indexOf("uses: actions/setup-node@v4");
    const installIndex = content.indexOf("pnpm install --frozen-lockfile");
    const actionIndex = content.indexOf("uses: tailor-platform/actions/deploy@v1");
    expect(checkoutIndex).toBeGreaterThan(-1);
    expect(pnpmIndex).toBeGreaterThan(checkoutIndex);
    expect(nodeIndex).toBeGreaterThan(pnpmIndex);
    expect(installIndex).toBeGreaterThan(nodeIndex);
    expect(actionIndex).toBeGreaterThan(installIndex);
  });

  it("passes workspace inputs", () => {
    const content = getDeployContent();
    expect(content).toContain("workspace-name: my-app");
    expect(content).toContain("workspace-region: asia-northeast");
    expect(content).toContain("organization-id: org-123");
    expect(content).toContain("folder-id: folder-456");
  });

  it("passes secrets as action inputs", () => {
    const content = getDeployContent();
    expect(content).toContain("platform-client-id: ${{ secrets.PLATFORM_MACHINE_USER_CLIENT_ID }}");
    expect(content).toContain(
      "platform-client-secret: ${{ secrets.PLATFORM_MACHINE_USER_CLIENT_SECRET }}",
    );
  });

  it("does not include working-directory when dir is '.'", () => {
    expect(getDeployContent()).not.toContain("working-directory");
  });

  it("includes working-directory when dir is not '.'", () => {
    expect(getDeployContent({ ...baseOptions, dir: "apps/foo" })).toContain(
      "working-directory: apps/foo",
    );
  });

  it("preserves $ characters in parameter values", () => {
    const content = getDeployContent({
      ...baseOptions,
      workspaceName: "test$&end",
    });
    expect(content).toContain("workspace-name: test$&end");
  });

  it("parameterizes concurrency group with workspace name", () => {
    const content = getDeployContent();
    expect(content).toContain("group: deploy-my-app");
    expect(content).not.toContain("group: deploy\n");
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

  it("writes files that do not exist", () => {
    const filePath = path.join(testDir, "workflow.yml");
    const result = writeFiles([{ path: filePath, content: "test content" }]);
    expect(result.written).toContain(filePath);
    expect(result.skipped).toHaveLength(0);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("test content");
  });

  it("skips files that already exist", () => {
    const filePath = path.join(testDir, "existing.yml");
    fs.writeFileSync(filePath, "original content");
    const result = writeFiles([{ path: filePath, content: "new content" }]);
    expect(result.skipped).toContain(filePath);
    expect(result.written).toHaveLength(0);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("original content");
  });

  it("creates parent directories as needed", () => {
    const filePath = path.join(testDir, "deep/nested/dir/file.yml");
    const result = writeFiles([{ path: filePath, content: "nested" }]);
    expect(result.written).toContain(filePath);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("nested");
  });

  it("handles mixed existing and new files", () => {
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
