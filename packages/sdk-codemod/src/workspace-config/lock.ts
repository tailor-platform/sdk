import * as path from "pathe";
import type { ProjectFiles } from "../types";

const LOCK_FILENAME = ".github/tailor.lock";
const MAX_ANCESTORS = 32;

type LockApp = {
  dir?: unknown;
  migrationDriftCheck?: unknown;
  seedValidate?: unknown;
  erdNamespaces?: unknown;
};

type LockTarget = {
  kind?: unknown;
  workspaceName?: unknown;
  inputs?: {
    dir?: unknown;
    apps?: LockApp[];
    erdPreview?: unknown;
    migrationTest?: unknown;
    migrationDriftCheck?: unknown;
    seedValidate?: unknown;
    erdNamespaces?: unknown;
  };
};

type LockData = Record<string, unknown> & {
  version?: unknown;
  targets?: LockTarget[];
  appIds?: Record<string, string>;
  workspaces?: string[];
  autofix?: { inputs?: { dirs?: unknown } };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDir(dir: string): string {
  const normalized = path.normalize(dir);
  return normalized === "" ? "." : normalized;
}

/** The `.github/tailor.lock` that governs the project, with the edits the conversions make. */
export class Lock {
  private changed = false;

  private constructor(
    private readonly project: ProjectFiles,
    /** Project-relative path of the lock file. */
    readonly path: string,
    /** Project-relative path of the directory that holds `.github/`. */
    private readonly root: string,
    private readonly data: LockData,
  ) {}

  /**
   * Find the lock in the project directory or the nearest ancestor, without leaving the repository.
   * @param project - The project
   * @returns The lock, or null when there is none or it is not a JSON object
   */
  static find(project: ProjectFiles): Lock | null {
    let root = ".";
    for (let depth = 0; depth < MAX_ANCESTORS; depth += 1) {
      const lockPath = path.join(root, LOCK_FILENAME);
      const source = project.read(lockPath);
      if (source !== undefined) {
        let data: unknown;
        try {
          data = JSON.parse(source);
        } catch {
          return null;
        }
        return isPlainObject(data) ? new Lock(project, lockPath, root, data as LockData) : null;
      }
      if (project.exists(path.join(root, ".git"))) return null;
      const parent = path.join(root, "..");
      if (path.resolve(project.root, parent) === path.resolve(project.root, root)) return null;
      root = parent;
    }
    return null;
  }

  /**
   * The project-relative paths of the configs of the lock targets that deploy several configs at once.
   * @returns One list per such target, each config named by its directory
   */
  multiConfigTargetDirs(): string[][] {
    return (this.data.targets ?? []).flatMap((target) => {
      const apps = target.inputs?.apps;
      if (!Array.isArray(apps)) return [];
      return [
        apps.flatMap((app) => (typeof app.dir === "string" ? [this.toProject(app.dir)] : [])),
      ];
    });
  }

  /**
   * Record a config as a workspace config and forget its app id.
   * @param configPath - Project-relative path of the config
   * @param deletedPaths - Project-relative paths of configs merged into it, whose app ids are forgotten too
   */
  recordWorkspace(configPath: string, deletedPaths: readonly string[] = []): void {
    const appIds = isPlainObject(this.data.appIds) ? { ...this.data.appIds } : undefined;
    for (const removed of [configPath, ...deletedPaths]) {
      const key = this.toLock(removed);
      if (appIds && key in appIds) {
        delete appIds[key];
        this.changed = true;
      }
    }
    if (appIds) this.data.appIds = appIds as Record<string, string>;
    const key = this.toLock(configPath);
    const workspaces = Array.isArray(this.data.workspaces) ? this.data.workspaces : [];
    if (!workspaces.includes(key)) {
      this.data.workspaces = [...workspaces, key].toSorted();
      this.changed = true;
    }
    if (this.data.version !== 3) {
      this.data.version = 3;
      this.changed = true;
    }
  }

  /**
   * Point the targets that deploy exactly `memberDirs` at the workspace config in `dir`, and the
   * autofix workflow's directories too.
   * @param memberDirs - Project-relative directories of the merged configs
   * @param dir - Project-relative directory of the workspace config
   * @returns The labels of the retargeted targets, and warnings about targets left as they are
   */
  retarget(
    memberDirs: readonly string[],
    dir: string,
  ): { retargeted: string[]; warnings: string[] } {
    const members = new Set(memberDirs.map((member) => this.toLock(member)));
    const workspaceDir = this.toLock(dir);
    const retargeted: string[] = [];
    const warnings: string[] = [];
    for (const target of this.data.targets ?? []) {
      const inputs = target.inputs;
      if (!inputs) continue;
      const label = `${String(target.kind)} ${String(target.workspaceName)}`;
      if (Array.isArray(inputs.apps)) {
        const dirs = inputs.apps.map((app) =>
          typeof app.dir === "string" ? normalizeDir(app.dir) : "",
        );
        if (dirs.length !== members.size || !dirs.every((appDir) => members.has(appDir))) continue;
        if (inputs.erdPreview === true || inputs.migrationTest === true) {
          warnings.push(
            `${LOCK_FILENAME}: the ${label} workflow previews ERDs or runs migration tests, which a workspace config does not support yet, so it still deploys the deleted configs. Run \`tailor setup ci ${String(target.kind)}\` again without --erd-preview and --migration-test.`,
          );
          continue;
        }
        const apps = inputs.apps;
        const erdNamespaces = apps.flatMap((app) =>
          Array.isArray(app.erdNamespaces) ? app.erdNamespaces : [],
        );
        delete inputs.apps;
        inputs.dir = workspaceDir;
        if (apps.some((app) => app.migrationDriftCheck === true)) inputs.migrationDriftCheck = true;
        if (apps.some((app) => app.seedValidate === true)) inputs.seedValidate = true;
        if (erdNamespaces.length > 0) inputs.erdNamespaces = [...new Set(erdNamespaces)];
        retargeted.push(label);
        this.changed = true;
      } else if (typeof inputs.dir === "string" && members.has(normalizeDir(inputs.dir))) {
        warnings.push(
          `${LOCK_FILENAME}: the ${label} workflow deploys only ${inputs.dir}, whose config was merged into ${this.toLock(path.join(dir, "tailor.config.ts"))}. Run \`tailor setup ci ${String(target.kind)}\` again for the workspace config, or delete the workflow.`,
        );
      }
    }
    const autofixInputs = this.data.autofix?.inputs;
    if (autofixInputs && Array.isArray(autofixInputs.dirs)) {
      const dirs = autofixInputs.dirs as unknown[];
      if (dirs.some((entry) => typeof entry === "string" && members.has(normalizeDir(entry)))) {
        autofixInputs.dirs = [
          ...new Set(
            dirs.map((entry) =>
              typeof entry === "string" && members.has(normalizeDir(entry)) ? workspaceDir : entry,
            ),
          ),
        ];
        retargeted.push("autofix");
        this.changed = true;
      }
    }
    return { retargeted, warnings };
  }

  /**
   * Warnings about targets that deploy a config converted in place with jobs a workspace config
   * does not support.
   * @param dir - Project-relative directory of the config
   * @returns The warnings
   */
  unsupportedJobWarnings(dir: string): string[] {
    const configDir = this.toLock(dir);
    return (this.data.targets ?? []).flatMap((target) => {
      const inputs = target.inputs;
      if (typeof inputs?.dir !== "string" || normalizeDir(inputs.dir) !== configDir) return [];
      if (inputs.erdPreview !== true && inputs.migrationTest !== true) return [];
      return [
        `${LOCK_FILENAME}: the ${String(target.kind)} ${String(target.workspaceName)} workflow previews ERDs or runs migration tests, which a workspace config does not support yet. Run \`tailor setup ci ${String(target.kind)}\` again without --erd-preview and --migration-test.`,
      ];
    });
  }

  /**
   * The edited lock file.
   * @returns Its new contents, or null when nothing changed
   */
  render(): string | null {
    return this.changed ? `${JSON.stringify(this.data, null, 2)}\n` : null;
  }

  private toLock(projectPath: string): string {
    return normalizeDir(
      path.relative(
        path.resolve(this.project.root, this.root),
        path.resolve(this.project.root, projectPath),
      ),
    );
  }

  private toProject(lockPath: string): string {
    return normalizeDir(
      path.relative(this.project.root, path.resolve(this.project.root, this.root, lockPath)),
    );
  }
}
