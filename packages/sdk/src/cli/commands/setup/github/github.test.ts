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

  it("returns 3 files", () => {
    const files = buildFiles(baseOptions);
    expect(files).toHaveLength(3);
  });

  it("generates correct file paths", () => {
    const files = buildFiles(baseOptions);
    const paths = files.map((f) => f.path);
    expect(paths).toContain(path.join(baseOptions.outputDir, ".github/workflows/deploy.yml"));
    expect(paths).toContain(
      path.join(baseOptions.outputDir, ".github/actions/fetch-tailor-token/action.yml"),
    );
    expect(paths).toContain(
      path.join(baseOptions.outputDir, ".github/actions/install-node/action.yml"),
    );
  });

  it("includes workspace name and region in deploy.yml", () => {
    const files = buildFiles(baseOptions);
    const deploy = files.find((f) => f.path.endsWith("deploy.yml"))!;
    expect(deploy.content).toContain("WORKSPACE_NAME: my-app");
    expect(deploy.content).toContain("WORKSPACE_REGION: asia-northeast");
  });

  it("includes organization ID and folder ID in deploy.yml", () => {
    const files = buildFiles(baseOptions);
    const deploy = files.find((f) => f.path.endsWith("deploy.yml"))!;
    expect(deploy.content).toContain("TAILOR_PLATFORM_ORGANIZATION_ID: org-123");
    expect(deploy.content).toContain("TAILOR_PLATFORM_FOLDER_ID: folder-456");
  });

  it("does not include working-directory when dir is '.'", () => {
    const files = buildFiles(baseOptions);
    const deploy = files.find((f) => f.path.endsWith("deploy.yml"))!;
    expect(deploy.content).not.toContain("working-directory");
  });

  it("includes working-directory when dir is not '.'", () => {
    const files = buildFiles({ ...baseOptions, dir: "apps/foo" });
    const deploy = files.find((f) => f.path.endsWith("deploy.yml"))!;
    expect(deploy.content).toContain("working-directory: apps/foo");
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

  it("writes files that do not exist", async () => {
    const filePath = path.join(testDir, "workflow.yml");
    const result = await writeFiles([{ path: filePath, content: "test content" }]);
    expect(result.written).toContain(filePath);
    expect(result.skipped).toHaveLength(0);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("test content");
  });

  it("skips files that already exist", async () => {
    const filePath = path.join(testDir, "existing.yml");
    fs.writeFileSync(filePath, "original content");
    const result = await writeFiles([{ path: filePath, content: "new content" }]);
    expect(result.skipped).toContain(filePath);
    expect(result.written).toHaveLength(0);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("original content");
  });

  it("creates parent directories as needed", async () => {
    const filePath = path.join(testDir, "deep/nested/dir/file.yml");
    const result = await writeFiles([{ path: filePath, content: "nested" }]);
    expect(result.written).toContain(filePath);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("nested");
  });

  it("handles mixed existing and new files", async () => {
    const existingPath = path.join(testDir, "existing.yml");
    const newPath = path.join(testDir, "new.yml");
    fs.writeFileSync(existingPath, "original");
    const result = await writeFiles([
      { path: existingPath, content: "updated" },
      { path: newPath, content: "brand new" },
    ]);
    expect(result.written).toContain(newPath);
    expect(result.skipped).toContain(existingPath);
  });
});
