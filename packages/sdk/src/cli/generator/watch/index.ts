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
 * Dependency graph manager type.
 */
export type DependencyGraphManager = {
  buildGraph: (filePaths: string[]) => Promise<void>;
  getDependents: (filePath: string) => string[];
  getDependencies: (filePath: string) => string[];
  findCircularDependencies: () => string[][];
  addNode: (filePath: string) => void;
  removeNode: (filePath: string) => void;
  getGraphStats: () => GraphStats;
};

/**
 * Creates a dependency graph manager.
 * @param options - Options for madge
 * @returns DependencyGraphManager instance
 */
export function createDependencyGraphManager(
  options: Parameters<MadgeLoader>[1] = {},
): DependencyGraphManager {
  const graph: Map<string, DependencyNode> = new Map();
  let madgeInstance: Awaited<ReturnType<MadgeLoader>> | null = null;
  let madgeLoader: MadgeLoader | null = null;

  function getMadgeLoader(): MadgeLoader {
    if (madgeLoader) {
      return madgeLoader;
    }

    const defaultExport = (madgeModule as { default?: unknown }).default;
    if (typeof defaultExport === "function") {
      madgeLoader = defaultExport as MadgeLoader;
      return madgeLoader;
    }

    if (typeof (madgeModule as unknown) === "function") {
      madgeLoader = madgeModule as unknown as MadgeLoader;
      return madgeLoader;
    }

    throw new WatcherError(
      "Failed to initialize madge analyzer: module did not export a callable function.",
      WatcherErrorCode.MADGE_INITIALIZATION_FAILED,
    );
  }

  function traverseDependents(filePath: string, visited: Set<string>): string[] {
    if (visited.has(filePath)) return [];
    visited.add(filePath);

    const node = graph.get(filePath);
    if (!node) return [];

    const result: string[] = [];
    for (const dependent of node.dependents) {
      result.push(dependent);
      result.push(...traverseDependents(dependent, visited));
    }

    return result;
  }

  function traverseDependencies(filePath: string, visited: Set<string>): string[] {
    if (visited.has(filePath)) return [];
    visited.add(filePath);

    const node = graph.get(filePath);
    if (!node) return [];

    const result: string[] = [];
    for (const dependency of node.dependencies) {
      result.push(dependency);
      result.push(...traverseDependencies(dependency, visited));
    }

    return result;
  }

  function addNode(filePath: string): void {
    const absolutePath = path.resolve(filePath);
    if (!graph.has(absolutePath)) {
      graph.set(absolutePath, {
        filePath: absolutePath,
        dependencies: new Set(),
        dependents: new Set(),
      });
    }
  }

  function removeNode(filePath: string): void {
    const absolutePath = path.resolve(filePath);
    const node = graph.get(absolutePath);
    if (!node) return;

    for (const dep of node.dependencies) {
      const depNode = graph.get(dep);
      if (depNode) {
        depNode.dependents.delete(absolutePath);
      }
    }

    for (const dependent of node.dependents) {
      const dependentNode = graph.get(dependent);
      if (dependentNode) {
        dependentNode.dependencies.delete(absolutePath);
      }
    }

    graph.delete(absolutePath);
  }

  function findCircularDependencies(): string[][] {
    if (!madgeInstance) return [];
    try {
      return madgeInstance.circular();
    } catch (error) {
      logger.warn(`Failed to detect circular dependencies: ${String(error)}`);
      return [];
    }
  }

  return {
    async buildGraph(filePaths: string[]): Promise<void> {
      try {
        if (filePaths.length === 0) return;

        const madge = getMadgeLoader();

        madgeInstance = await madge(filePaths, {
          fileExtensions: ["ts", "js"],
          excludeRegExp: [/node_modules/],
          baseDir: ".",
          ...options,
        });

        const dependencyObj = madgeInstance.obj() as Record<string, string[]>;
        graph.clear();

        for (const filePath of filePaths) {
          addNode(filePath);
        }

        for (const [filePath, dependencies] of Object.entries(dependencyObj)) {
          const absoluteFilePath = path.resolve(".", filePath);
          const node = graph.get(absoluteFilePath);
          if (!node) continue;

          for (const dep of dependencies) {
            const absoluteDepPath = path.resolve(".", dep);
            node.dependencies.add(absoluteDepPath);

            const depNode = graph.get(absoluteDepPath);
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
    },

    getDependents(filePath: string): string[] {
      const visited = new Set<string>();
      return traverseDependents(path.resolve(filePath), visited);
    },

    getDependencies(filePath: string): string[] {
      const visited = new Set<string>();
      return traverseDependencies(path.resolve(filePath), visited);
    },

    findCircularDependencies,
    addNode,
    removeNode,

    getGraphStats(): GraphStats {
      let edgeCount = 0;
      for (const node of graph.values()) {
        edgeCount += node.dependencies.size;
      }

      return {
        nodeCount: graph.size,
        edgeCount,
        circularDependencyCount: findCircularDependencies().length,
      };
    },
  };
}

/**
 * Dependency watcher type.
 */
export type DependencyWatcher = {
  initialize: () => Promise<void>;
  addWatchGroup: (groupId: string, patterns: string[]) => Promise<void>;
  removeWatchGroup: (groupId: string) => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  onError: (callback: ErrorCallback) => void;
  updateDependencyGraph: () => Promise<void>;
  calculateImpact: (filePath: string) => ImpactAnalysisResult;
  detectCircularDependencies: () => string[][];
  getWatchStatus: () => WatchStatus;
  setRestartCallback: (callback: () => void) => void;
};

/**
 * Creates a dependency watcher.
 * @param options - Watcher options
 * @returns DependencyWatcher instance
 */
export function createDependencyWatcher(options: WatcherOptions = {}): DependencyWatcher {
  let chokidarWatcher: ReturnType<typeof chokidar.watch> | null = null;
  const watchGroups: Map<string, WatchGroup> = new Map();
  const dependencyGraphManager = createDependencyGraphManager(options.madgeOptions);
  let errorCallback: ErrorCallback | null = null;
  const debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  let isInitialized = false;
  const dependencyCache: Map<string, string[]> = new Map();
  const maxCacheSize = 1000;
  let signalHandlersRegistered = false;
  let restartCallback: (() => void) | null = null;

  function validateWatchGroup(groupId: string, patterns: string[]): void {
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

    if (watchGroups.has(groupId)) {
      throw new WatcherError(
        `Watch group with ID '${groupId}' already exists`,
        WatcherErrorCode.INVALID_WATCH_GROUP,
      );
    }
  }

  function handleError(error: WatcherError): void {
    logger.error(
      `[DependencyWatcher] ${error.message} (code: ${error.code}, filePath: ${error.filePath})`,
    );

    if (errorCallback) {
      errorCallback(error);
    }
  }

  function setCacheValue(key: string, value: string[]): void {
    if (dependencyCache.size >= maxCacheSize) {
      const firstKey = dependencyCache.keys().next().value;
      if (firstKey) {
        dependencyCache.delete(firstKey);
      }
    }
    dependencyCache.set(key, value);
  }

  function findAffectedFiles(changedFile: string): string[] {
    return dependencyGraphManager.getDependents(changedFile);
  }

  function findAffectedGroups(affectedFiles: string[]): string[] {
    logger.debug(`Finding affected groups for files: ${affectedFiles.join(", ")}`);
    const affectedGroupsSet = new Set<string>();

    for (const [groupId, group] of watchGroups) {
      for (const affectedFile of affectedFiles) {
        if (group.files.has(affectedFile)) {
          logger.debug(`Group ${groupId} is affected by file: ${affectedFile}`);
          affectedGroupsSet.add(groupId);
          break;
        }
      }
    }

    return Array.from(affectedGroupsSet);
  }

  function calculateImpact(filePath: string): ImpactAnalysisResult {
    const cacheKey = `impact:${filePath}`;
    let affectedFiles = dependencyCache.get(cacheKey);

    if (!affectedFiles) {
      affectedFiles = findAffectedFiles(filePath);
      setCacheValue(cacheKey, affectedFiles);
    }

    // Include the changed file itself in the affected files
    const allAffectedFiles = [filePath, ...affectedFiles];
    const affectedGroups = findAffectedGroups(allAffectedFiles);

    return {
      changedFile: filePath,
      affectedFiles: allAffectedFiles,
      affectedGroups,
    };
  }

  async function updateDependencyGraph(): Promise<void> {
    const allFiles: string[] = [];
    for (const group of watchGroups.values()) {
      allFiles.push(...Array.from(group.files));
    }

    await dependencyGraphManager.buildGraph(allFiles);
    dependencyCache.clear();

    if (options.detectCircularDependencies) {
      const circularDeps = dependencyGraphManager.findCircularDependencies();
      if (circularDeps.length > 0) {
        logger.warn(`Circular dependencies detected: ${JSON.stringify(circularDeps)}`);
      }
    }
  }

  async function handleFileChange(event: FileChangeEvent, filePath: string): Promise<void> {
    try {
      const absolutePath = path.resolve(filePath);

      if (event === "unlink") {
        dependencyGraphManager.removeNode(absolutePath);
      } else {
        dependencyGraphManager.addNode(absolutePath);
        if (event === "change") {
          await updateDependencyGraph();
        }
      }

      dependencyCache.clear();

      const impactResult = calculateImpact(absolutePath);

      // If any groups are affected, trigger restart instead of calling callbacks
      if (impactResult.affectedGroups.length > 0) {
        logger.info("File change detected, restarting watch process...", {
          mode: "stream",
        });
        logger.info(`Changed file: ${absolutePath}`, { mode: "stream" });
        logger.info(`Affected groups: ${impactResult.affectedGroups.join(", ")}`, {
          mode: "stream",
        });

        if (restartCallback) {
          restartCallback();
        }
      } else {
        logger.debug(`No affected groups found for file: ${absolutePath}`);
      }
    } catch (error) {
      handleError(
        new WatcherError(
          `Failed to handle file change: ${error instanceof Error ? error.message : String(error)}`,
          WatcherErrorCode.DEPENDENCY_ANALYSIS_FAILED,
          filePath,
          error instanceof Error ? error : undefined,
        ),
      );
    }
  }

  function debounceFileChange(event: FileChangeEvent, filePath: string): void {
    const key = `${event}:${filePath}`;

    if (debounceTimers.has(key)) {
      clearTimeout(debounceTimers.get(key));
    }

    const timer = setTimeout(() => {
      handleFileChange(event, filePath);
      debounceTimers.delete(key);
    }, options.debounceTime || 100);

    debounceTimers.set(key, timer);
  }

  async function stop(): Promise<void> {
    if (chokidarWatcher) {
      await chokidarWatcher.close();
      chokidarWatcher = null;
    }

    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();

    removeSignalHandlers();
    isInitialized = false;
  }

  function setupSignalHandlers(): void {
    if (signalHandlersRegistered) return;

    const handleSignal = async () => {
      try {
        await stop();
        logger.info("Watcher stopped successfully");
        process.exit(0);
      } catch (error) {
        logger.error(`Error during shutdown: ${String(error)}`);
        process.exit(0);
      }
    };

    process.on("SIGINT", () => handleSignal());
    process.on("SIGTERM", () => handleSignal());
    signalHandlersRegistered = true;
  }

  function removeSignalHandlers(): void {
    if (!signalHandlersRegistered) return;

    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    signalHandlersRegistered = false;
  }

  async function initialize(): Promise<void> {
    if (isInitialized) return;

    try {
      chokidarWatcher = chokidar.watch([], {
        ignored: /node_modules/,
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 100,
        },
        ...options.chokidarOptions,
      });

      chokidarWatcher.on("add", (filePath: string) => {
        logger.debug(`File added: ${filePath}`);
        debounceFileChange("add", filePath);
      });

      chokidarWatcher.on("change", (filePath: string) => {
        logger.debug(`File changed: ${filePath}`);
        debounceFileChange("change", filePath);
      });

      chokidarWatcher.on("unlink", (filePath: string) => {
        logger.debug(`File removed: ${filePath}`);
        debounceFileChange("unlink", filePath);
      });

      chokidarWatcher.on("error", (error: unknown) => {
        logger.error(`Watcher error: ${error instanceof Error ? error.message : String(error)}`, {
          mode: "stream",
        });
        handleError(
          new WatcherError(
            `File watcher error: ${error instanceof Error ? error.message : String(error)}`,
            WatcherErrorCode.FILE_WATCH_FAILED,
            undefined,
            error instanceof Error ? error : undefined,
          ),
        );
      });

      setupSignalHandlers();
      isInitialized = true;
    } catch (error) {
      throw new WatcherError(
        `Failed to initialize watcher: ${error instanceof Error ? error.message : String(error)}`,
        WatcherErrorCode.FILE_WATCH_FAILED,
        undefined,
        error instanceof Error ? error : undefined,
      );
    }
  }

  return {
    initialize,

    async addWatchGroup(groupId: string, patterns: string[]): Promise<void> {
      validateWatchGroup(groupId, patterns);

      if (!isInitialized) {
        await initialize();
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

      watchGroups.set(groupId, watchGroup);

      if (chokidarWatcher) {
        const filePaths = Array.from(files);
        chokidarWatcher.add(filePaths);
      }

      await updateDependencyGraph();
    },

    async removeWatchGroup(groupId: string): Promise<void> {
      const watchGroup = watchGroups.get(groupId);
      if (!watchGroup) return;

      if (chokidarWatcher) {
        chokidarWatcher.unwatch(watchGroup.patterns);
      }

      for (const filePath of watchGroup.files) {
        dependencyGraphManager.removeNode(filePath);
      }

      watchGroups.delete(groupId);
      dependencyCache.clear();
    },

    async start(): Promise<void> {
      if (!isInitialized) {
        await initialize();
      }
      await updateDependencyGraph();
    },

    stop,

    onError(callback: ErrorCallback): void {
      errorCallback = callback;
    },

    updateDependencyGraph,
    calculateImpact,

    detectCircularDependencies(): string[][] {
      return dependencyGraphManager.findCircularDependencies();
    },

    getWatchStatus(): WatchStatus {
      let fileCount = 0;
      for (const group of watchGroups.values()) {
        fileCount += group.files.size;
      }

      const stats = dependencyGraphManager.getGraphStats();

      return {
        isWatching: isInitialized && chokidarWatcher !== null,
        groupCount: watchGroups.size,
        fileCount,
        dependencyNodeCount: stats.nodeCount,
      };
    },

    setRestartCallback(callback: () => void): void {
      restartCallback = callback;
    },
  };
}

export { WatcherErrorCode };
