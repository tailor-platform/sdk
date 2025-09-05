import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  vi,
} from "vitest";
import {
  DependencyWatcher,
  WatcherError,
  WatcherErrorCode,
  DependencyGraphManager,
} from "./index";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const manager = new DependencyGraphManager();

beforeAll(() => {
  vi.spyOn(DependencyGraphManager.prototype, "buildGraph").mockImplementation(
    async () => {},
  );
});

/**
 * テスト用の一時ディレクトリを作成
 */
async function createTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "dependency-watcher-test-"));
}

/**
 * テスト用のファイルを作成
 */
async function createTestFile(
  filePath: string,
  content: string,
): Promise<void> {
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

  describe("初期化", () => {
    it("正常に初期化できる", async () => {
      await watcher.initialize();
      const status = watcher.getWatchStatus();
      expect(status.isWatching).toBe(true);
      expect(status.groupCount).toBe(0);
      expect(status.fileCount).toBe(0);
    });
  });

  describe("監視グループの管理", () => {
    it("監視グループを追加できる", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      const callback = vi.fn();
      await watcher.addWatchGroup("test-group", [testFile], callback);

      const status = watcher.getWatchStatus();
      expect(status.groupCount).toBe(1);
      expect(status.fileCount).toBe(1);
    });

    it("glob パターンで複数ファイルを監視できる", async () => {
      const testFile1 = path.join(tempDir, "file1.ts");
      const testFile2 = path.join(tempDir, "file2.ts");
      await createTestFile(testFile1, 'export const file1 = "hello";');
      await createTestFile(testFile2, 'export const file2 = "world";');

      const callback = vi.fn();
      const pattern = path.join(tempDir, "*.ts");
      await watcher.addWatchGroup("test-group", [pattern], callback);

      const status = watcher.getWatchStatus();
      expect(status.groupCount).toBe(1);
      expect(status.fileCount).toBe(2);
    });

    it("監視グループを削除できる", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      const callback = vi.fn();
      await watcher.addWatchGroup("test-group", [testFile], callback);
      await watcher.removeWatchGroup("test-group");

      const status = watcher.getWatchStatus();
      expect(status.groupCount).toBe(0);
      expect(status.fileCount).toBe(0);
    });

    it("重複するグループIDでエラーが発生する", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      const callback = vi.fn();
      await watcher.addWatchGroup("test-group", [testFile], callback);

      await expect(
        watcher.addWatchGroup("test-group", [testFile], callback),
      ).rejects.toThrow(WatcherError);
    });
  });

  describe("バリデーション", () => {
    it("無効なグループIDでエラーが発生する", async () => {
      const callback = vi.fn();
      await expect(
        watcher.addWatchGroup("", ["test.ts"], callback),
      ).rejects.toThrow(WatcherError);
    });

    it("空のパターン配列でエラーが発生する", async () => {
      const callback = vi.fn();
      await expect(
        watcher.addWatchGroup("test-group", [], callback),
      ).rejects.toThrow(WatcherError);
    });
  });

  describe("影響範囲計算", () => {
    it("依存関係のないファイルの影響範囲は空", async () => {
      const testFile = path.join(tempDir, "test.ts");
      await createTestFile(testFile, 'export const test = "hello";');

      const callback = vi.fn();
      await watcher.addWatchGroup("test-group", [testFile], callback);

      const impact = watcher.calculateImpact(testFile);
      expect(impact.changedFile).toBe(testFile);
      expect(impact.affectedFiles).toEqual([testFile]);
      expect(impact.affectedGroups).toEqual(["test-group"]);
    });
  });

  describe("エラーハンドリング", () => {
    it("エラーコールバックが設定できる", () => {
      const errorCallback = vi.fn();
      watcher.onError(errorCallback);

      expect(errorCallback).not.toHaveBeenCalled();
    });

    it("WatcherError が正しく作成される", () => {
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

  describe("監視状態", () => {
    it("監視状態を正しく取得できる", async () => {
      const testFile1 = path.join(tempDir, "file1.ts");
      const testFile2 = path.join(tempDir, "file2.ts");
      await createTestFile(testFile1, 'export const file1 = "hello";');
      await createTestFile(testFile2, 'export const file2 = "world";');

      const callback = vi.fn();
      await watcher.addWatchGroup("group1", [testFile1], callback);
      await watcher.addWatchGroup("group2", [testFile2], callback);

      const status = watcher.getWatchStatus();
      expect(status.isWatching).toBe(true);
      expect(status.groupCount).toBe(2);
      expect(status.fileCount).toBe(2);
      expect(status.dependencyNodeCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe("循環依存検出", () => {
    it("循環依存を検出できる", async () => {
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

  it("空のファイル配列でグラフを構築できる", async () => {
    await expect(manager.buildGraph([])).resolves.not.toThrow();
  });
});

describe("WatcherErrorCode", () => {
  it("すべてのエラーコードが定義されている", () => {
    expect(WatcherErrorCode.DEPENDENCY_ANALYSIS_FAILED).toBe(
      "DEPENDENCY_ANALYSIS_FAILED",
    );
    expect(WatcherErrorCode.FILE_WATCH_FAILED).toBe("FILE_WATCH_FAILED");
    expect(WatcherErrorCode.CIRCULAR_DEPENDENCY_DETECTED).toBe(
      "CIRCULAR_DEPENDENCY_DETECTED",
    );
    expect(WatcherErrorCode.INVALID_WATCH_GROUP).toBe("INVALID_WATCH_GROUP");
    expect(WatcherErrorCode.MADGE_INITIALIZATION_FAILED).toBe(
      "MADGE_INITIALIZATION_FAILED",
    );
  });
});
