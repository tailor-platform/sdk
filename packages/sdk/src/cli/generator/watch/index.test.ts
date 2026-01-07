/* eslint-disable import/order */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const madgeMock = vi.hoisted(() =>
  vi.fn(async () => ({
    obj: () => ({}),
    circular: () => [],
  })),
);

vi.mock("madge", () => ({
  default: madgeMock,
}));

import { DependencyGraphManager, DependencyWatcher, WatcherError, WatcherErrorCode } from "./index";

let manager: DependencyGraphManager;

beforeEach(() => {
  madgeMock.mockReset();
  madgeMock.mockImplementation(async () => ({
    obj: () => ({}),
    circular: () => [],
  }));
  manager = new DependencyGraphManager();
});

/**
 * Create temporary directory for testing
 * @returns {Promise<string>} Path to the created temporary directory
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "dependency-watcher-test-"));
}

/**
 * Create files for testing
 * @param {string} filePath - Path of the file to create
 * @param {string} content - File contents
 * @returns {Promise<void>} Promise that resolves when the file is created
 */
async function createTestFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

describe("DependencyWatcher", () => {
  let tempDir: string;
  let watcher: DependencyWatcher;

  beforeEach(async () => {
    tempDir = await createTempDir();
    watcher = new DependencyWatcher({
      debounceTime: 10,
      detectCircularDependencies: true,
    });
  });

  afterEach(async () => {
    await watcher.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("initialization", () => {
    it("can initialize correctly", async () => {
      await watcher.initialize();
      const status = watcher.getWatchStatus();
      expect(status.isWatching).toBe(true);
      expect(status.groupCount).toBe(0);
      expect(status.fileCount).toBe(0);
    });
  });

  describe("watch group management", () => {
    it("can add watch group", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      await watcher.addWatchGroup("test-group", [testFile]);

      const status = watcher.getWatchStatus();
      expect(status.groupCount).toBe(1);
      expect(status.fileCount).toBe(1);
    });

    it("can watch multiple files with glob pattern", async () => {
      const testFile1 = path.join(tempDir, "file1.ts");
      const testFile2 = path.join(tempDir, "file2.ts");
      await createTestFile(testFile1, 'export const file1 = "hello";');
      await createTestFile(testFile2, 'export const file2 = "world";');

      const pattern = path.join(tempDir, "*.ts");
      await watcher.addWatchGroup("test-group", [pattern]);

      const status = watcher.getWatchStatus();
      expect(status.groupCount).toBe(1);
      expect(status.fileCount).toBe(2);
    });

    it("can remove watch group", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      await watcher.addWatchGroup("test-group", [testFile]);
      await watcher.removeWatchGroup("test-group");

      const status = watcher.getWatchStatus();
      expect(status.groupCount).toBe(0);
      expect(status.fileCount).toBe(0);
    });

    it("duplicate group ID causes error", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      await watcher.addWatchGroup("test-group", [testFile]);

      await expect(watcher.addWatchGroup("test-group", [testFile])).rejects.toThrow(WatcherError);
    });
  });

  describe("validation", () => {
    it("invalid group ID causes error", async () => {
      await expect(watcher.addWatchGroup("", ["test.ts"])).rejects.toThrow(WatcherError);
    });

    it("empty pattern array causes error", async () => {
      await expect(watcher.addWatchGroup("test-group", [])).rejects.toThrow(WatcherError);
    });
  });

  describe("impact scope calculation", () => {
    it("impact scope is empty for files without dependencies", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      await watcher.addWatchGroup("test-group", [testFile]);

      const impact = watcher.calculateImpact(testFile);
      expect(impact.changedFile).toBe(testFile);
      expect(impact.affectedFiles).toEqual([testFile]);
      expect(impact.affectedGroups).toEqual(["test-group"]);
    });
  });

  describe("error handling", () => {
    it("can set error callback", () => {
      const errorCallback = vi.fn();
      watcher.onError(errorCallback);

      expect(errorCallback).not.toHaveBeenCalled();
    });

    it("WatcherError is created correctly", () => {
      const error = new WatcherError(
        "Test error",
        WatcherErrorCode.INVALID_WATCH_GROUP,
        "/test/file.ts",
      );

      expect(error.message).toBe("Test error");
      expect(error.code).toBe(WatcherErrorCode.INVALID_WATCH_GROUP);
      expect(error.filePath).toBe("/test/file.ts");
      expect(error.name).toBe("WatcherError");
    });
  });

  describe("watch status", () => {
    it("can get watch status correctly", async () => {
      const testFile1 = path.join(tempDir, "file1.ts");
      const testFile2 = path.join(tempDir, "file2.ts");
      await createTestFile(testFile1, 'export const file1 = "hello";');
      await createTestFile(testFile2, 'export const file2 = "world";');

      await watcher.addWatchGroup("group1", [testFile1]);
      await watcher.addWatchGroup("group2", [testFile2]);

      const status = watcher.getWatchStatus();
      expect(status.isWatching).toBe(true);
      expect(status.groupCount).toBe(2);
      expect(status.fileCount).toBe(2);
      expect(status.dependencyNodeCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("circular dependency detection", () => {
    it("can detect circular dependencies", async () => {
      const circular = watcher.detectCircularDependencies();
      expect(Array.isArray(circular)).toBe(true);
    });
  });
});

describe("DependencyGraphManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("can build graph with empty file array", async () => {
    await expect(manager.buildGraph([])).resolves.not.toThrow();
  });

  it("calls madge to build dependency graph", async () => {
    const testFile = path.join(tempDir, "sample.ts");
    await createTestFile(testFile, "export const value = 1;");

    await manager.buildGraph([testFile]);

    expect(madgeMock).toHaveBeenCalledWith(
      [testFile],
      expect.objectContaining({
        fileExtensions: expect.arrayContaining(["ts", "js"]),
      }),
    );
  });

  it("detects error when madge does not provide function", async () => {
    const mockedMadge = await import("madge");
    const originalDefault = (mockedMadge as { default?: unknown }).default;
    (mockedMadge as { default?: unknown }).default = undefined;

    const localManager = new DependencyGraphManager();

    try {
      await expect(
        localManager.buildGraph([path.join(tempDir, "broken.ts")]),
      ).rejects.toMatchObject({
        code: WatcherErrorCode.MADGE_INITIALIZATION_FAILED,
      });
    } finally {
      (mockedMadge as { default?: unknown }).default = originalDefault;
    }
  });
});

describe("WatcherErrorCode", () => {
  it("all error codes are defined", () => {
    expect(WatcherErrorCode.DEPENDENCY_ANALYSIS_FAILED).toBe("DEPENDENCY_ANALYSIS_FAILED");
    expect(WatcherErrorCode.FILE_WATCH_FAILED).toBe("FILE_WATCH_FAILED");
    expect(WatcherErrorCode.CIRCULAR_DEPENDENCY_DETECTED).toBe("CIRCULAR_DEPENDENCY_DETECTED");
    expect(WatcherErrorCode.INVALID_WATCH_GROUP).toBe("INVALID_WATCH_GROUP");
    expect(WatcherErrorCode.MADGE_INITIALIZATION_FAILED).toBe("MADGE_INITIALIZATION_FAILED");
  });
});
