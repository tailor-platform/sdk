import chokidar from "chokidar";
import * as madge from "madge";
import { glob } from "node:fs/promises";
import * as path from "node:path";

/**
 * ファイル変更イベントの種類
 */
type FileChangeEvent = "add" | "change" | "unlink";

/**
 * ファイル変更情報
 */
interface FileChangeInfo {
  /** 変更されたファイルのパス */
  filePath: string;
  /** 変更イベントの種類 */
  event: FileChangeEvent;
  /** 変更時刻 */
  timestamp: Date;
}

/**
 * 監視対象グループの定義
 */
interface WatchGroup {
  /** グループの一意識別子 */
  id: string;
  /** 監視対象のファイルパターン（glob形式） */
  patterns: string[];
  /** グループに含まれるファイルの絶対パス一覧 */
  files: Set<string>;
}

/**
 * 依存関係グラフのノード
 */
interface DependencyNode {
  /** ファイルの絶対パス */
  filePath: string;
  /** このファイルが依存しているファイル一覧 */
  dependencies: Set<string>;
  /** このファイルに依存しているファイル一覧 */
  dependents: Set<string>;
}

/**
 * 影響範囲計算結果
 */
interface ImpactAnalysisResult {
  /** 変更されたファイル */
  changedFile: string;
  /** 影響を受けるファイル一覧（変更されたファイルに依存している全てのファイル） */
  affectedFiles: string[];
  /** 影響を受ける監視グループ一覧 */
  affectedGroups: string[];
}

/**
 * 変更通知コールバック関数の型
 */
type ChangeCallback = (
  changeInfo: FileChangeInfo,
  impactResult: ImpactAnalysisResult,
) => void | Promise<void>;

/**
 * エラーハンドリングコールバック関数の型
 */
type ErrorCallback = (error: WatcherError) => void;

/**
 * 監視システムのオプション
 */
interface WatcherOptions {
  /** chokidarのオプション */
  chokidarOptions?: any;
  /** madgeのオプション */
  madgeOptions?: any;
  /** 依存関係グラフの更新間隔（ミリ秒） */
  dependencyUpdateInterval?: number;
  /** デバウンス時間（ミリ秒） */
  debounceTime?: number;
  /** 循環依存の検出を有効にするか */
  detectCircularDependencies?: boolean;
}

/**
 * 監視状態
 */
interface WatchStatus {
  /** 監視中かどうか */
  isWatching: boolean;
  /** 監視対象グループ数 */
  groupCount: number;
  /** 監視対象ファイル数 */
  fileCount: number;
  /** 依存関係グラフのノード数 */
  dependencyNodeCount: number;
}

/**
 * グラフ統計情報
 */
interface GraphStats {
  /** ノード数 */
  nodeCount: number;
  /** エッジ数 */
  edgeCount: number;
  /** 循環依存数 */
  circularDependencyCount: number;
}

/**
 * エラーコード
 */
const WatcherErrorCode = {
  DEPENDENCY_ANALYSIS_FAILED: "DEPENDENCY_ANALYSIS_FAILED",
  FILE_WATCH_FAILED: "FILE_WATCH_FAILED",
  CIRCULAR_DEPENDENCY_DETECTED: "CIRCULAR_DEPENDENCY_DETECTED",
  INVALID_WATCH_GROUP: "INVALID_WATCH_GROUP",
  MADGE_INITIALIZATION_FAILED: "MADGE_INITIALIZATION_FAILED",
} as const;
type WatcherErrorCode =
  (typeof WatcherErrorCode)[keyof typeof WatcherErrorCode];

/**
 * 監視システム固有のエラー
 */
export class WatcherError extends Error {
  constructor(
    message: string,
    public readonly code: WatcherErrorCode,
    public readonly filePath?: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = "WatcherError";
  }
}

/**
 * 依存関係グラフの管理を専門に行うクラス
 */
export class DependencyGraphManager {
  private graph: Map<string, DependencyNode> = new Map();
  private madgeInstance: any | null = null;

  constructor(private readonly options: any = {}) {}

  /**
   * 指定されたファイル群から依存関係グラフを構築
   */
  async buildGraph(filePaths: string[]): Promise<void> {
    try {
      if (filePaths.length === 0) return;

      this.madgeInstance = await madge(filePaths, {
        fileExtensions: ["ts", "js"],
        excludeRegExp: [/node_modules/],
        baseDir: ".",
        ...this.options,
      });

      const dependencyObj = this.madgeInstance.obj() as Record<
        string,
        string[]
      >;
      this.graph.clear();

      for (const filePath of filePaths) {
        this.addNode(filePath);
      }

      for (const [filePath, dependencies] of Object.entries(dependencyObj)) {
        const absoluteFilePath = path.resolve(".", filePath);
        const node = this.graph.get(absoluteFilePath);
        if (!node) continue;

        for (const dep of dependencies) {
          const absoluteDepPath = path.resolve(".", dep);
          node.dependencies.add(absoluteDepPath);

          const depNode = this.graph.get(absoluteDepPath);
          if (depNode) {
            depNode.dependents.add(absoluteFilePath);
          }
        }
      }
    } catch (error) {
      throw new WatcherError(
        `Failed to build dependency graph: ${error instanceof Error ? error.message : String(error)}`,
        WatcherErrorCode.DEPENDENCY_ANALYSIS_FAILED,
        undefined,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * 特定のファイルに依存している全てのファイルを取得（全階層）
   */
  getDependents(filePath: string): string[] {
    const visited = new Set<string>();
    return this.traverseDependents(path.resolve(filePath), visited);
  }

  /**
   * 特定のファイルが依存している全てのファイルを取得（全階層）
   */
  getDependencies(filePath: string): string[] {
    const visited = new Set<string>();
    return this.traverseDependencies(path.resolve(filePath), visited);
  }

  /**
   * 循環依存を検出
   */
  findCircularDependencies(): string[][] {
    if (!this.madgeInstance) return [];
    try {
      return this.madgeInstance.circular();
    } catch (error) {
      console.warn("Failed to detect circular dependencies:", error);
      return [];
    }
  }

  /**
   * グラフにノードを追加
   */
  addNode(filePath: string): void {
    const absolutePath = path.resolve(filePath);
    if (!this.graph.has(absolutePath)) {
      this.graph.set(absolutePath, {
        filePath: absolutePath,
        dependencies: new Set(),
        dependents: new Set(),
      });
    }
  }

  /**
   * グラフからノードを削除
   */
  removeNode(filePath: string): void {
    const absolutePath = path.resolve(filePath);
    const node = this.graph.get(absolutePath);
    if (!node) return;

    for (const dep of node.dependencies) {
      const depNode = this.graph.get(dep);
      if (depNode) {
        depNode.dependents.delete(absolutePath);
      }
    }

    for (const dependent of node.dependents) {
      const dependentNode = this.graph.get(dependent);
      if (dependentNode) {
        dependentNode.dependencies.delete(absolutePath);
      }
    }

    this.graph.delete(absolutePath);
  }

  /**
   * グラフの統計情報を取得
   */
  getGraphStats(): GraphStats {
    let edgeCount = 0;
    for (const node of this.graph.values()) {
      edgeCount += node.dependencies.size;
    }

    return {
      nodeCount: this.graph.size,
      edgeCount,
      circularDependencyCount: this.findCircularDependencies().length,
    };
  }

  private traverseDependents(filePath: string, visited: Set<string>): string[] {
    if (visited.has(filePath)) return [];
    visited.add(filePath);

    const node = this.graph.get(filePath);
    if (!node) return [];

    const result: string[] = [];
    for (const dependent of node.dependents) {
      result.push(dependent);
      result.push(...this.traverseDependents(dependent, visited));
    }

    return result;
  }

  private traverseDependencies(
    filePath: string,
    visited: Set<string>,
  ): string[] {
    if (visited.has(filePath)) return [];
    visited.add(filePath);

    const node = this.graph.get(filePath);
    if (!node) return [];

    const result: string[] = [];
    for (const dependency of node.dependencies) {
      result.push(dependency);
      result.push(...this.traverseDependencies(dependency, visited));
    }

    return result;
  }
}

/**
 * chokidarとmadgeを使った依存関係監視システム
 */
class DependencyWatcher {
  private chokidarWatcher: any | null = null;
  private watchGroups: Map<string, WatchGroup> = new Map();
  private dependencyGraphManager: DependencyGraphManager;
  private changeCallbacks: Map<string, ChangeCallback> = new Map();
  private errorCallback: ErrorCallback | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized = false;
  private dependencyCache: Map<string, string[]> = new Map();
  private readonly maxCacheSize = 1000;
  private signalHandlersRegistered = false;

  constructor(private readonly options: WatcherOptions = {}) {
    this.dependencyGraphManager = new DependencyGraphManager(
      options.madgeOptions,
    );
  }

  /**
   * 監視システムを初期化
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log("🚀 Initializing watcher...");
      this.chokidarWatcher = chokidar.watch([], {
        ignored: /node_modules/,
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 100,
        },
        ...this.options.chokidarOptions,
      });

      this.chokidarWatcher.on("ready", () => {
        console.log("✅ Watcher is ready");
      });

      this.chokidarWatcher.on("add", (filePath: string) => {
        console.log(`➕ File added: ${filePath}`);
        this.debounceFileChange("add", filePath);
      });

      this.chokidarWatcher.on("change", (filePath: string) => {
        console.log(`📝 File changed: ${filePath}`);
        this.debounceFileChange("change", filePath);
      });

      this.chokidarWatcher.on("unlink", (filePath: string) => {
        console.log(`🗑️ File removed: ${filePath}`);
        this.debounceFileChange("unlink", filePath);
      });

      this.chokidarWatcher.on("error", (error: Error) => {
        console.error(`❌ Watcher error: ${error.message}`);
        this.handleError(
          new WatcherError(
            `File watcher error: ${error.message}`,
            WatcherErrorCode.FILE_WATCH_FAILED,
            undefined,
            error,
          ),
        );
      });

      this.setupSignalHandlers();
      this.isInitialized = true;
    } catch (error) {
      throw new WatcherError(
        `Failed to initialize watcher: ${error instanceof Error ? error.message : String(error)}`,
        WatcherErrorCode.FILE_WATCH_FAILED,
        undefined,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * 監視対象グループを追加
   */
  async addWatchGroup(
    groupId: string,
    patterns: string[],
    callback: ChangeCallback,
  ): Promise<void> {
    this.validateWatchGroup(groupId, patterns);

    if (!this.isInitialized) {
      await this.initialize();
    }

    const files = new Set<string>();
    for (const pattern of patterns) {
      console.log(
        `Adding watch pattern for ${groupId}: ${path.resolve(pattern)}`,
      );
      for await (const file of glob(pattern)) {
        files.add(path.resolve(file));
      }
    }

    const watchGroup: WatchGroup = {
      id: groupId,
      patterns,
      files,
    };

    this.watchGroups.set(groupId, watchGroup);
    this.changeCallbacks.set(groupId, callback);

    if (this.chokidarWatcher) {
      const filePaths = Array.from(files);
      this.chokidarWatcher.add(filePaths);
    }

    await this.updateDependencyGraph();
  }

  /**
   * 監視対象グループを削除
   */
  async removeWatchGroup(groupId: string): Promise<void> {
    const watchGroup = this.watchGroups.get(groupId);
    if (!watchGroup) return;

    if (this.chokidarWatcher) {
      this.chokidarWatcher.unwatch(watchGroup.patterns);
    }

    for (const filePath of watchGroup.files) {
      this.dependencyGraphManager.removeNode(filePath);
    }

    this.watchGroups.delete(groupId);
    this.changeCallbacks.delete(groupId);
    this.dependencyCache.clear();
  }

  /**
   * 監視を開始
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    await this.updateDependencyGraph();
  }

  /**
   * 監視を停止
   */
  async stop(): Promise<void> {
    if (this.chokidarWatcher) {
      await this.chokidarWatcher.close();
      this.chokidarWatcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.removeSignalHandlers();
    this.isInitialized = false;
  }

  /**
   * エラーハンドリングコールバックを設定
   */
  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  /**
   * 依存関係グラフを手動で更新
   */
  async updateDependencyGraph(): Promise<void> {
    const allFiles: string[] = [];
    for (const group of this.watchGroups.values()) {
      allFiles.push(...Array.from(group.files));
    }

    await this.dependencyGraphManager.buildGraph(allFiles);
    this.dependencyCache.clear();

    if (this.options.detectCircularDependencies) {
      const circularDeps =
        this.dependencyGraphManager.findCircularDependencies();
      if (circularDeps.length > 0) {
        console.warn("Circular dependencies detected:", circularDeps);
      }
    }
  }

  /**
   * 特定のファイルの影響範囲を計算
   */
  calculateImpact(filePath: string): ImpactAnalysisResult {
    const cacheKey = `impact:${filePath}`;
    let affectedFiles = this.dependencyCache.get(cacheKey);

    if (!affectedFiles) {
      affectedFiles = this.findAffectedFiles(filePath);
      this.setCacheValue(cacheKey, affectedFiles);
    }

    // 変更されたファイル自体も影響を受けるファイルに含める
    const allAffectedFiles = [filePath, ...affectedFiles];
    const affectedGroups = this.findAffectedGroups(allAffectedFiles);

    return {
      changedFile: filePath,
      affectedFiles: allAffectedFiles,
      affectedGroups,
    };
  }

  /**
   * 循環依存を検出
   */
  detectCircularDependencies(): string[][] {
    return this.dependencyGraphManager.findCircularDependencies();
  }

  /**
   * 現在の監視状態を取得
   */
  getWatchStatus(): WatchStatus {
    let fileCount = 0;
    for (const group of this.watchGroups.values()) {
      fileCount += group.files.size;
    }

    const stats = this.dependencyGraphManager.getGraphStats();

    return {
      isWatching: this.isInitialized && this.chokidarWatcher !== null,
      groupCount: this.watchGroups.size,
      fileCount,
      dependencyNodeCount: stats.nodeCount,
    };
  }

  private debounceFileChange(event: FileChangeEvent, filePath: string): void {
    const key = `${event}:${filePath}`;

    if (this.debounceTimers.has(key)) {
      clearTimeout(this.debounceTimers.get(key));
    }

    const timer = setTimeout(() => {
      this.handleFileChange(event, filePath);
      this.debounceTimers.delete(key);
    }, this.options.debounceTime || 100);

    this.debounceTimers.set(key, timer);
  }

  private async handleFileChange(
    event: FileChangeEvent,
    filePath: string,
  ): Promise<void> {
    try {
      const absolutePath = path.resolve(filePath);

      const changeInfo: FileChangeInfo = {
        filePath: absolutePath,
        event,
        timestamp: new Date(),
      };

      if (event === "unlink") {
        this.dependencyGraphManager.removeNode(absolutePath);
      } else {
        this.dependencyGraphManager.addNode(absolutePath);
        if (event === "change") {
          await this.updateDependencyGraph();
        }
      }

      this.dependencyCache.clear();

      const impactResult = this.calculateImpact(absolutePath);
      for (const groupId of impactResult.affectedGroups) {
        console.log(`🎯 Calling callback for group: ${groupId}`);
        const callback = this.changeCallbacks.get(groupId);
        if (callback) {
          try {
            await callback(changeInfo, impactResult);
          } catch (error) {
            this.handleError(
              new WatcherError(
                `Callback error for group ${groupId}: ${error instanceof Error ? error.message : String(error)}`,
                WatcherErrorCode.DEPENDENCY_ANALYSIS_FAILED,
                absolutePath,
                error instanceof Error ? error : undefined,
              ),
            );
          }
        } else {
          console.log(`⚠️ No callback found for group: ${groupId}`);
        }
      }

      if (impactResult.affectedGroups.length === 0) {
        console.log(`⚠️ No affected groups found for file: ${absolutePath}`);
      }
    } catch (error) {
      this.handleError(
        new WatcherError(
          `Failed to handle file change: ${error instanceof Error ? error.message : String(error)}`,
          WatcherErrorCode.DEPENDENCY_ANALYSIS_FAILED,
          filePath,
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  private findAffectedFiles(changedFile: string): string[] {
    return this.dependencyGraphManager.getDependents(changedFile);
  }

  private findAffectedGroups(affectedFiles: string[]): string[] {
    console.log(`🔍 Finding affected groups for files:`, affectedFiles);
    const affectedGroups = new Set<string>();

    for (const [groupId, group] of this.watchGroups) {
      for (const affectedFile of affectedFiles) {
        if (group.files.has(affectedFile)) {
          console.log(
            `✅ Group ${groupId} is affected by file: ${affectedFile}`,
          );
          affectedGroups.add(groupId);
          break;
        }
      }
    }

    return Array.from(affectedGroups);
  }

  private validateWatchGroup(groupId: string, patterns: string[]): void {
    if (!groupId || typeof groupId !== "string") {
      throw new WatcherError(
        "Group ID must be a non-empty string",
        WatcherErrorCode.INVALID_WATCH_GROUP,
      );
    }

    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new WatcherError(
        "Patterns must be a non-empty array",
        WatcherErrorCode.INVALID_WATCH_GROUP,
      );
    }

    if (this.watchGroups.has(groupId)) {
      throw new WatcherError(
        `Watch group with ID '${groupId}' already exists`,
        WatcherErrorCode.INVALID_WATCH_GROUP,
      );
    }
  }

  private handleError(error: WatcherError): void {
    console.error(`[DependencyWatcher] ${error.message}`, {
      code: error.code,
      filePath: error.filePath,
    });

    if (this.errorCallback) {
      this.errorCallback(error);
    }
  }

  private setCacheValue(key: string, value: string[]): void {
    if (this.dependencyCache.size >= this.maxCacheSize) {
      const firstKey = this.dependencyCache.keys().next().value;
      if (firstKey) {
        this.dependencyCache.delete(firstKey);
      }
    }
    this.dependencyCache.set(key, value);
  }

  /**
   * SIGINTシグナルハンドラーを設定
   */
  private setupSignalHandlers(): void {
    if (this.signalHandlersRegistered) return;

    const handleSignal = async () => {
      try {
        await this.stop();
        console.log("Watcher stopped successfully");
        process.exit(0);
      } catch (error) {
        console.error("Error during shutdown:", error);
        process.exit(0);
      }
    };

    process.on("SIGINT", () => handleSignal());
    process.on("SIGTERM", () => handleSignal());
    this.signalHandlersRegistered = true;
  }

  /**
   * シグナルハンドラーを削除
   */
  private removeSignalHandlers(): void {
    if (!this.signalHandlersRegistered) return;

    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    this.signalHandlersRegistered = false;
  }
}

export {
  DependencyWatcher,
  type FileChangeEvent,
  type FileChangeInfo,
  type WatchGroup,
  type DependencyNode,
  type ImpactAnalysisResult,
  type ChangeCallback,
  type ErrorCallback,
  type WatcherOptions,
  type WatchStatus,
  type GraphStats,
  WatcherErrorCode,
};
