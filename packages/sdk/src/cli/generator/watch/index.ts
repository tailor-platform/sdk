import { glob } from "node:fs/promises";
import chokidar from "chokidar";
import * as madgeModule from "madge";
import * as path from "pathe";
import { logger, styles } from "@/cli/utils/logger";
import type { MadgeLoader } from "./types";

/**
 * Types of file change events.
 */
type FileChangeEvent = "add" | "change" | "unlink";

/**
 * Definition of a watch group.
 */
interface WatchGroup {
  /** Unique identifier of the group. */
  id: string;
  /** File patterns to watch (glob format). */
  patterns: string[];
  /** List of absolute file paths in the group. */
  files: Set<string>;
}

/**
 * Node in the dependency graph.
 */
interface DependencyNode {
  /** Absolute path of the file. */
  filePath: string;
  /** List of files this file depends on. */
  dependencies: Set<string>;
  /** List of files that depend on this file. */
  dependents: Set<string>;
}

/**
 * Impact analysis result.
 */
interface ImpactAnalysisResult {
  /** Changed file. */
  changedFile: string;
  /** List of affected files (all files depending on the changed file). */
  affectedFiles: string[];
  /** List of affected watch groups. */
  affectedGroups: string[];
}

/**
 * Type of the error handling callback.
 */
type ErrorCallback = (error: WatcherError) => void;

/**
 * Options for the watcher system.
 */
interface WatcherOptions {
  /** Options for chokidar. */
  chokidarOptions?: Parameters<typeof chokidar.watch>[1];
  /** Options for madge. */
  madgeOptions?: Parameters<MadgeLoader>[1];
  /** Update interval for the dependency graph (milliseconds). */
  dependencyUpdateInterval?: number;
  /** Debounce duration (milliseconds). */
  debounceTime?: number;
  /** Whether to enable circular dependency detection. */
  detectCircularDependencies?: boolean;
}

/**
 * Watcher status.
 */
interface WatchStatus {
  /** Whether watching is active. */
  isWatching: boolean;
  /** Number of watch groups. */
  groupCount: number;
  /** Number of watched files. */
  fileCount: number;
  /** Number of nodes in the dependency graph. */
  dependencyNodeCount: number;
}

/**
 * Graph statistics.
 */
interface GraphStats {
  /** Number of nodes. */
  nodeCount: number;
  /** Number of edges. */
  edgeCount: number;
  /** Number of circular dependencies. */
  circularDependencyCount: number;
}

/**
 * Error codes.
 */
const WatcherErrorCode = {
  DEPENDENCY_ANALYSIS_FAILED: "DEPENDENCY_ANALYSIS_FAILED",
  FILE_WATCH_FAILED: "FILE_WATCH_FAILED",
  CIRCULAR_DEPENDENCY_DETECTED: "CIRCULAR_DEPENDENCY_DETECTED",
  INVALID_WATCH_GROUP: "INVALID_WATCH_GROUP",
  MADGE_INITIALIZATION_FAILED: "MADGE_INITIALIZATION_FAILED",
} as const;
type WatcherErrorCode = (typeof WatcherErrorCode)[keyof typeof WatcherErrorCode];

/**
 * Watcher-specific error.
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
 * Class dedicated to managing the dependency graph.
 */
export class DependencyGraphManager {
  private graph: Map<string, DependencyNode> = new Map();
  private madgeInstance: Awaited<ReturnType<MadgeLoader>> | null = null;
  private madgeLoader: MadgeLoader | null = null;

  constructor(private readonly options: Parameters<MadgeLoader>[1] = {}) {}

  /**
   * Build the dependency graph from the given files.
   * @param {string[]} filePaths - File paths to analyze
   * @returns {Promise<void>} Promise that resolves when the graph is built
   */
  async buildGraph(filePaths: string[]): Promise<void> {
    try {
      if (filePaths.length === 0) return;

      const madge = this.getMadgeLoader();

      this.madgeInstance = await madge(filePaths, {
        fileExtensions: ["ts", "js"],
        excludeRegExp: [/node_modules/],
        baseDir: ".",
        ...this.options,
      });

      const dependencyObj = this.madgeInstance.obj() as Record<string, string[]>;
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
      if (error instanceof WatcherError) {
        throw error;
      }
      throw new WatcherError(
        `Failed to build dependency graph: ${error instanceof Error ? error.message : String(error)}`,
        WatcherErrorCode.DEPENDENCY_ANALYSIS_FAILED,
        undefined,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private getMadgeLoader(): MadgeLoader {
    if (this.madgeLoader) {
      return this.madgeLoader;
    }

    const defaultExport = (madgeModule as { default?: unknown }).default;
    if (typeof defaultExport === "function") {
      this.madgeLoader = defaultExport as MadgeLoader;
      return this.madgeLoader;
    }

    if (typeof (madgeModule as unknown) === "function") {
      this.madgeLoader = madgeModule as unknown as MadgeLoader;
      return this.madgeLoader;
    }

    throw new WatcherError(
      "Failed to initialize madge analyzer: module did not export a callable function.",
      WatcherErrorCode.MADGE_INITIALIZATION_FAILED,
    );
  }

  /**
   * Get every file that depends on the specified file (all levels).
   * @param {string} filePath - File path to inspect
   * @returns {string[]} List of dependent files
   */
  getDependents(filePath: string): string[] {
    const visited = new Set<string>();
    return this.traverseDependents(path.resolve(filePath), visited);
  }

  /**
   * Get every file the specified file depends on (all levels).
   * @param {string} filePath - File path to inspect
   * @returns {string[]} List of dependency files
   */
  getDependencies(filePath: string): string[] {
    const visited = new Set<string>();
    return this.traverseDependencies(path.resolve(filePath), visited);
  }

  /**
   * Detect circular dependencies.
   * @returns {string[][]} List of circular dependency cycles
   */
  findCircularDependencies(): string[][] {
    if (!this.madgeInstance) return [];
    try {
      return this.madgeInstance.circular();
    } catch (error) {
      logger.warn(`Failed to detect circular dependencies: ${String(error)}`);
      return [];
    }
  }

  /**
   * Add a node to the graph.
   * @param {string} filePath - File path to add as a node
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
   * Remove a node from the graph.
   * @param {string} filePath - File path to remove from the graph
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
   * Get graph statistics.
   * @returns {GraphStats} Current dependency graph statistics
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

  private traverseDependencies(filePath: string, visited: Set<string>): string[] {
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
 * Dependency watching system backed by chokidar and madge.
 */
class DependencyWatcher {
  private chokidarWatcher: ReturnType<typeof chokidar.watch> | null = null;
  private watchGroups: Map<string, WatchGroup> = new Map();
  private dependencyGraphManager: DependencyGraphManager;
  private errorCallback: ErrorCallback | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized = false;
  private dependencyCache: Map<string, string[]> = new Map();
  private readonly maxCacheSize = 1000;
  private signalHandlersRegistered = false;

  constructor(private readonly options: WatcherOptions = {}) {
    this.dependencyGraphManager = new DependencyGraphManager(options.madgeOptions);
  }

  /**
   * Initialize the watcher system.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
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

      this.chokidarWatcher.on("add", (filePath: string) => {
        logger.debug(`File added: ${filePath}`);
        this.debounceFileChange("add", filePath);
      });

      this.chokidarWatcher.on("change", (filePath: string) => {
        logger.debug(`File changed: ${filePath}`);
        this.debounceFileChange("change", filePath);
      });

      this.chokidarWatcher.on("unlink", (filePath: string) => {
        logger.debug(`File removed: ${filePath}`);
        this.debounceFileChange("unlink", filePath);
      });

      this.chokidarWatcher.on("error", (error: unknown) => {
        logger.error(`Watcher error: ${error instanceof Error ? error.message : String(error)}`, {
          mode: "stream",
        });
        this.handleError(
          new WatcherError(
            `File watcher error: ${error instanceof Error ? error.message : String(error)}`,
            WatcherErrorCode.FILE_WATCH_FAILED,
            undefined,
            error instanceof Error ? error : undefined,
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
   * Add a watch group.
   * @param {string} groupId - Group identifier
   * @param {string[]} patterns - Glob patterns to watch
   * @returns {Promise<void>} Promise that resolves when the group is added
   */
  async addWatchGroup(groupId: string, patterns: string[]): Promise<void> {
    this.validateWatchGroup(groupId, patterns);

    if (!this.isInitialized) {
      await this.initialize();
    }

    const files = new Set<string>();
    for (const pattern of patterns) {
      logger.log(
        `${styles.dim(`Watch pattern for`)} ${styles.dim(groupId + ":")} ${path.relative(process.cwd(), pattern)}`,
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

    if (this.chokidarWatcher) {
      const filePaths = Array.from(files);
      this.chokidarWatcher.add(filePaths);
    }

    await this.updateDependencyGraph();
  }

  /**
   * Remove a watch group.
   * @param {string} groupId - Group identifier
   * @returns {Promise<void>} Promise that resolves when the group is removed
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
    this.dependencyCache.clear();
  }

  /**
   * Start watching.
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    await this.updateDependencyGraph();
  }

  /**
   * Stop watching.
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
   * Set the error handling callback.
   * @param {ErrorCallback} callback - Error callback
   * @returns {void}
   */
  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  /**
   * Manually refresh the dependency graph.
   */
  async updateDependencyGraph(): Promise<void> {
    const allFiles: string[] = [];
    for (const group of this.watchGroups.values()) {
      allFiles.push(...Array.from(group.files));
    }

    await this.dependencyGraphManager.buildGraph(allFiles);
    this.dependencyCache.clear();

    if (this.options.detectCircularDependencies) {
      const circularDeps = this.dependencyGraphManager.findCircularDependencies();
      if (circularDeps.length > 0) {
        logger.warn(`Circular dependencies detected: ${JSON.stringify(circularDeps)}`);
      }
    }
  }

  /**
   * Compute the impact scope of a specific file.
   * @param {string} filePath - File path to analyze
   * @returns {ImpactAnalysisResult} Impact analysis result for the file
   */
  calculateImpact(filePath: string): ImpactAnalysisResult {
    const cacheKey = `impact:${filePath}`;
    let affectedFiles = this.dependencyCache.get(cacheKey);

    if (!affectedFiles) {
      affectedFiles = this.findAffectedFiles(filePath);
      this.setCacheValue(cacheKey, affectedFiles);
    }

    // Include the changed file itself in the affected files
    const allAffectedFiles = [filePath, ...affectedFiles];
    const affectedGroups = this.findAffectedGroups(allAffectedFiles);

    return {
      changedFile: filePath,
      affectedFiles: allAffectedFiles,
      affectedGroups,
    };
  }

  /**
   * Detect circular dependencies.
   * @returns {string[][]} List of circular dependency cycles
   */
  detectCircularDependencies(): string[][] {
    return this.dependencyGraphManager.findCircularDependencies();
  }

  /**
   * Retrieve the current watcher status.
   * @returns {WatchStatus} Snapshot of the current watcher status
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

  private restartCallback: (() => void) | null = null;

  /**
   * Set the restart callback to be called when a file change is detected.
   * @param {() => void} callback - Restart callback
   */
  setRestartCallback(callback: () => void): void {
    this.restartCallback = callback;
  }

  private async handleFileChange(event: FileChangeEvent, filePath: string): Promise<void> {
    try {
      const absolutePath = path.resolve(filePath);

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

      // If any groups are affected, trigger restart instead of calling callbacks
      if (impactResult.affectedGroups.length > 0) {
        logger.info("File change detected, restarting watch process...", {
          mode: "stream",
        });
        logger.info(`Changed file: ${absolutePath}`, { mode: "stream" });
        logger.info(`Affected groups: ${impactResult.affectedGroups.join(", ")}`, {
          mode: "stream",
        });

        if (this.restartCallback) {
          this.restartCallback();
        }
      } else {
        logger.debug(`No affected groups found for file: ${absolutePath}`);
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
    logger.debug(`Finding affected groups for files: ${affectedFiles.join(", ")}`);
    const affectedGroups = new Set<string>();

    for (const [groupId, group] of this.watchGroups) {
      for (const affectedFile of affectedFiles) {
        if (group.files.has(affectedFile)) {
          logger.debug(`Group ${groupId} is affected by file: ${affectedFile}`);
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
    logger.error(
      `[DependencyWatcher] ${error.message} (code: ${error.code}, filePath: ${error.filePath})`,
    );

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
   * Register signal handlers.
   * @returns {void}
   */
  private setupSignalHandlers(): void {
    if (this.signalHandlersRegistered) return;

    const handleSignal = async () => {
      try {
        await this.stop();
        logger.info("Watcher stopped successfully");
        process.exit(0);
      } catch (error) {
        logger.error(`Error during shutdown: ${String(error)}`);
        process.exit(0);
      }
    };

    process.on("SIGINT", () => handleSignal());
    process.on("SIGTERM", () => handleSignal());
    this.signalHandlersRegistered = true;
  }

  /**
   * Remove signal handlers.
   * @returns {void}
   */
  private removeSignalHandlers(): void {
    if (!this.signalHandlersRegistered) return;

    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    this.signalHandlersRegistered = false;
  }
}

export { DependencyWatcher, WatcherErrorCode };
