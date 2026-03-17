import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFiles, writeFiles } from "./github";
import { installNodeYaml } from "./templates";

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

  it("generates correct file paths", () => {
    const files = buildFiles(baseOptions);
    const paths = files.map((f) => f.path);
    expect(paths).toContain(
      path.join(baseOptions.outputDir, ".github/workflows/deploy-my-app.yml"),
    );
    expect(paths).toContain(
      path.join(baseOptions.outputDir, ".github/actions/fetch-tailor-token/action.yml"),
    );
    expect(paths).toContain(
      path.join(baseOptions.outputDir, ".github/actions/install-node/action.yml"),
    );
  });

  it("includes all env vars in deploy.yml", () => {
    const content = getDeployContent();
    expect(content).toContain("WORKSPACE_NAME: my-app");
    expect(content).toContain("WORKSPACE_REGION: asia-northeast");
    expect(content).toContain("TAILOR_PLATFORM_ORGANIZATION_ID: org-123");
    expect(content).toContain("TAILOR_PLATFORM_FOLDER_ID: folder-456");
  });

  it("does not include working-directory when dir is '.'", () => {
    expect(getDeployContent()).not.toContain("working-directory");
  });

  it("includes working-directory when dir is not '.'", () => {
    expect(getDeployContent({ ...baseOptions, dir: "apps/foo" })).toContain(
      "working-directory: apps/foo",
    );
  });

  it("uses pnpm run deploy for the deploy step", () => {
    const content = getDeployContent();
    expect(content).toContain("run: pnpm run deploy -- --yes");
    expect(content).not.toContain("run: pnpm apply");
  });

  it("preserves $ characters in parameter values", () => {
    const content = getDeployContent({
      ...baseOptions,
      workspaceName: "test$&end",
    });
    expect(content).toContain("WORKSPACE_NAME: test$&end");
  });
});

describe("installNodeYaml", () => {
  it("pins pnpm version for projects without packageManager field", () => {
    expect(installNodeYaml).toContain("version: 10");
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
