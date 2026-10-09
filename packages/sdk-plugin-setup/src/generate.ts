import * as fs from "node:fs";
import {
  extractOwnedNamespaces,
  findAppIdLock,
  loadConfig,
  logger,
  planAppIds,
  removeAdoptedConfigIds,
  styles,
  TAILOR_LOCK_FILENAME,
  workspaceNameSchema,
  getNamespacesWithMigrations,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { detectDefaultBranch, type GitRunner } from "./git";
import {
  findTarget,
  LOCK_VERSION,
  readLock,
  writeLock,
  type LockFile,
  type LockInputs,
  type LockTarget,
  type TargetKind,
} from "./lock";
import {
  computeManagedHash,
  computeManagedParts,
  currentContentHash,
  describeHandEdit,
  describeReservedId,
  editedPartsOf,
  findReservedIds,
  isManagedHash,
  ManagedMergeError,
  mergeUserContent,
} from "./managed";
import {
  appSlug,
  detectPackageManager,
  renderBranchWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  TEMPLATE_VERSION,
  type PackageManager,
  type RenderApp,
  type RenderResult,
} from "./templates";

type CommonSetupOptions = {
  workspaceName?: string;
  /** App directory, or several deployed together in one multi-config run. */
  dir: string | readonly string[];
  environment?: string;
  force: boolean;
  outputDir: string;
  /** Injectable git runner, for testing. */
  gitRunner?: GitRunner;
  /** Injectable config-name loader, for testing. Defaults to loading the config. */
  loadConfigName?: (configPath: string) => Promise<string | undefined>;
  /** Injectable config-id loader, for testing. Defaults to loading the config. */
  loadConfigId?: (configPath: string) => Promise<string | undefined>;
  /** Injectable TailorDB namespace loader, for testing. Defaults to loading the config. */
  loadErdNamespaces?: (configPath: string) => Promise<string[]>;
  /** Injectable migration config detector, for testing. Defaults to loading the config. */
  loadHasMigrations?: (configPath: string) => Promise<boolean>;
  /** Injectable seed plugin detector, for testing. Defaults to loading the config. */
  loadHasSeeds?: (configPath: string) => Promise<boolean>;
};

export type BranchSetupOptions = CommonSetupOptions & {
  kind: "branch";
  branch?: string;
  /** Extra `paths` filter patterns beyond the app directories. */
  extraPaths?: readonly string[];
  erdPreview: boolean;
  restrictDispatch?: boolean;
};

type TagSetupOptions = CommonSetupOptions & {
  kind: "tag";
  tagPattern: string;
  branch?: string;
  restrictDispatch?: boolean;
};

type PreviewSetupOptions = CommonSetupOptions & {
  kind: "preview";
  branch?: string;
  /** Extra `paths` filter patterns beyond the app directories. */
  extraPaths?: readonly string[];
  /** Workspace region for preview workspace creation (e.g. `us-west`). */
  region: string;
  /**
   * When true, the preview workflow deploys only for PRs labeled `tailor:preview`.
   * Default false: preview deploys on every PR.
   */
  requirePreviewLabel?: boolean;
  /**
   * When true, draft PRs get a preview too.
   * Default false: drafts are skipped and the preview deploys once the PR is ready for review.
   */
  includeDrafts?: boolean;
};

export type SetupTargetOptions = BranchSetupOptions | TagSetupOptions | PreviewSetupOptions;

async function defaultLoadConfigName(configPath: string): Promise<string | undefined> {
  const { config } = await loadConfig(configPath);
  return config.name;
}

async function defaultLoadConfigId(configPath: string): Promise<string | undefined> {
  const { config } = await loadConfig(configPath);
  return config.id;
}

async function defaultLoadErdNamespaces(configPath: string): Promise<string[]> {
  const { config } = await loadConfig(configPath);
  return extractOwnedNamespaces(config);
}

async function defaultLoadHasMigrations(configPath: string): Promise<boolean> {
  const { config } = await loadConfig(configPath);
  return getNamespacesWithMigrations(config, path.dirname(configPath)).length > 0;
}

async function defaultLoadHasSeeds(configPath: string): Promise<boolean> {
  const { plugins } = await loadConfig(configPath);
  return plugins.some((p) => p.id === "@tailor-platform/seed");
}

// The name is used as the plan label, the generated file name, and the default
// GitHub Environment name, so it must stay within the workspace-name charset.
/**
 * Reject workspace names that do not match the Platform naming rules.
 * @param name - Workspace name
 */
export function validateWorkspaceName(name: string): void {
  if (!workspaceNameSchema.safeParse(name).success) {
    throw new Error(
      `Invalid workspace name "${name}". Names must be 3-63 characters of lowercase ` +
        "letters, numbers, and hyphens, and cannot start or end with a hyphen. " +
        "Pass a valid name with --name.",
    );
  }
}

// The values below are embedded into workflow YAML. Restrict them to
// characters that are safe inside a double-quoted YAML scalar (and cannot
// smuggle a ${{ }} expression into the generated file).
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const TAG_PATTERN_RE = /^[A-Za-z0-9._/*?![\]-]+$/;

function validateBranch(branch: string): void {
  if (!BRANCH_RE.test(branch)) {
    throw new Error(
      `Invalid branch name "${branch}". Only letters, numbers, ".", "_", "/", and "-" are supported here.`,
    );
  }
}

function validateTagPattern(pattern: string): void {
  if (!TAG_PATTERN_RE.test(pattern)) {
    throw new Error(
      `Invalid tag pattern "${pattern}". Only letters, numbers, ".", "_", "/", "-", and the glob characters "*?![]" are supported.`,
    );
  }
}

// The environment name is embedded into workflow YAML as a plain scalar.
const ENVIRONMENT_RE = /^[A-Za-z0-9._/-]+$/;

/**
 * Reject GitHub Environment names that cannot be embedded as-is in generated files.
 * @param environment - GitHub Environment name
 */
export function validateEnvironment(environment: string): void {
  if (!ENVIRONMENT_RE.test(environment)) {
    throw new Error(
      `Invalid environment name "${environment}". Only letters, numbers, ".", "_", "/", and "-" are supported.`,
    );
  }
}

// `--region` is embedded into workflow YAML as a plain scalar.
const REGION_RE = /^[A-Za-z0-9._-]+$/;

function validateRegion(region: string): void {
  if (!REGION_RE.test(region)) {
    throw new Error(
      `Invalid region "${region}". Only letters, numbers, ".", "_", and "-" are supported.`,
    );
  }
}

// `--dir` is embedded into workflow YAML (paths filters / working-directory).
// Restrict it to POSIX path characters so it cannot break the YAML or smuggle
// in a ${{ }} expression. Checked after backslashes are normalized to "/".
const DIR_RE = /^[A-Za-z0-9._/-]+$/;

function validateDir(dir: string): void {
  if (!DIR_RE.test(dir)) {
    throw new Error(
      `Invalid --dir "${dir}". Only letters, numbers, ".", "_", "/", and "-" are supported.`,
    );
  }
}

// `--paths` patterns are embedded one per line into a YAML block scalar that
// GitHub evaluates, so only line breaks and expressions could escape it.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const UNSUPPORTED_GLOB_RE = /[?+[\]{}()\\]/;

function isSafePathPattern(pattern: string): boolean {
  return (
    pattern.length > 0 &&
    pattern === pattern.trim() &&
    !pattern.includes("${{") &&
    !CONTROL_CHAR_RE.test(pattern)
  );
}

function resolveExtraPaths(options: SetupTargetOptions, dirs: readonly string[]): string[] {
  const extraPaths =
    options.kind === "branch" || options.kind === "preview" ? [...(options.extraPaths ?? [])] : [];
  for (const pattern of extraPaths) {
    if (!isSafePathPattern(pattern)) {
      throw new Error(
        `Invalid --paths ${JSON.stringify(pattern)}. A pattern cannot contain line breaks or ` +
          "control characters, a ${{ }} expression, or leading or trailing whitespace.",
      );
    }
    if (UNSUPPORTED_GLOB_RE.test(pattern)) {
      throw new Error(
        `Invalid --paths ${JSON.stringify(pattern)}. Change detection supports only \`*\`, ` +
          "`**`, and a leading `!`; the characters ? + [ ] { } ( ) and \\ are not supported.",
      );
    }
  }
  if (extraPaths.length > 0 && dirs.includes(".")) {
    throw new Error(
      "--paths has no effect when --dir is the repository root: the workflow already runs on " +
        "every change.",
    );
  }
  return extraPaths;
}

// ERD namespaces are embedded into a GitHub Actions matrix and artifact file
// names. Keep them to path-safe scalar values.
const ERD_NAMESPACE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateErdNamespaces(namespaces: readonly string[]): void {
  for (const namespace of namespaces) {
    if (!ERD_NAMESPACE_RE.test(namespace)) {
      throw new Error(
        `TailorDB namespace "${namespace}" cannot be used in --erd-preview. ` +
          "Only letters, numbers, '.', '_', and '-' are supported, and the name must start with a letter or number.",
      );
    }
  }
}

// `rel` is "" for the root itself, ".." or "../foo" for an escape. Guard on
// the path segment so a sibling-prefixed name like "..foo" is not rejected.
function escapesRoot(rel: string): boolean {
  return (
    rel === ".." || rel.startsWith(`..${path.sep}`) || rel.startsWith("../") || path.isAbsolute(rel)
  );
}

/**
 * Resolve the config file path for the given app directory.
 *
 * `--dir` must stay inside the repository: the value is embedded in workflow
 * `paths:` filters and the config under it may be edited (its id moves into the lock), so
 * absolute paths and `..` traversal are rejected.
 * @param outputDir - Repository root (cwd)
 * @param dir - App directory relative to the repo root
 * @returns Absolute path to tailor.config.ts
 */
function resolveConfigPath(outputDir: string, dir: string): string {
  const appDir = path.resolve(outputDir, dir);
  const rel = path.relative(outputDir, appDir);
  if (path.isAbsolute(dir) || escapesRoot(rel)) {
    throw new Error(`--dir must be a relative path inside the repository (got "${dir}").`);
  }
  // Also catch symlinked subdirectories that point outside the repository.
  if (fs.existsSync(appDir)) {
    const realAppDir = path.normalize(fs.realpathSync(appDir));
    const realOutputDir = path.normalize(fs.realpathSync(outputDir));
    const realRel = path.relative(realOutputDir, realAppDir);
    if (escapesRoot(realRel)) {
      throw new Error(
        `--dir must resolve to a directory inside the repository (got "${dir}", which links outside it).`,
      );
    }
  }
  const configPath = path.join(appDir, "tailor.config.ts");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `tailor.config.ts not found at ${configPath}. ` +
        "Run this from your SDK project root, or pass the app directory with --dir.",
    );
  }
  return configPath;
}

type Resolved = {
  kind: TargetKind;
  workspaceName: string;
  branch: string | null;
  environment: string;
  packageManager: PackageManager;
  erdNamespaces: string[];
  render: RenderResult;
  inputs: LockInputs;
  file: string;
  configPaths: string[];
};

// Normalize before any filesystem use and before embedding into workflow
// YAML (paths filters / working-directory): POSIX separators, collapse
// duplicate slashes, drop a leading "./" and trailing "/" so values like
// "./apps/backend/" produce a clean "apps/backend".
function normalizeDir(dir: string): string {
  const normalized =
    path.normalize(dir.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/$/, "") || ".";
  validateDir(normalized);
  return normalized;
}

function assertDistinctConfigs(dirs: readonly string[], configPaths: readonly string[]): void {
  const byRealPath = new Map<string, string>();
  for (const [index, configPath] of configPaths.entries()) {
    const dir = dirs[index] ?? configPath;
    const realPath = fs.realpathSync(configPath);
    const other = byRealPath.get(realPath);
    if (other !== undefined) {
      throw new Error(
        `--dir "${other}" and "${dir}" are the same app: both reach the same tailor.config.ts ` +
          "through a symbolic link. Pass each app directory once.",
      );
    }
    byRealPath.set(realPath, dir);
  }
}

function rootDeclaresSdk(outputDir: string): boolean {
  const manifestPath = path.join(outputDir, "package.json");
  if (!fs.existsSync(manifestPath)) return false;
  let manifest: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as typeof manifest;
  } catch (cause) {
    throw new Error("package.json at the repository root is not valid JSON. Fix it and re-run.", {
      cause,
    });
  }
  return [manifest.dependencies, manifest.devDependencies].some(
    (deps) => deps !== undefined && Object.hasOwn(deps, "@tailor-platform/sdk"),
  );
}

function assertMultiDirTarget(options: SetupTargetOptions, dirs: readonly string[]): void {
  if (options.workspaceName === undefined) {
    throw new Error(
      "--name is required when --dir is given more than once: it names the workflow, its " +
        "file, and the default GitHub Environment, which no single config's name can do.",
    );
  }
  if (!rootDeclaresSdk(options.outputDir)) {
    throw new Error(
      "Add @tailor-platform/sdk to the dependencies of package.json at the repository root. " +
        "With more than one --dir, the workflow plans and deploys every app from the " +
        "repository root, so the tailor CLI must resolve there.",
    );
  }
  const bySlug = new Map<string, string>();
  for (const dir of dirs) {
    const other = bySlug.get(appSlug(dir));
    if (other !== undefined) {
      throw new Error(
        `--dir "${other}" and "${dir}" map to the same step id suffix "${appSlug(dir)}". ` +
          "Pass each app directory once, under distinct names.",
      );
    }
    bySlug.set(appSlug(dir), dir);
  }
}

/**
 * Resolve all derived values and render the workflow content.
 * @param options - Setup options
 * @returns Resolved target metadata and rendered content
 */
async function resolve(options: SetupTargetOptions): Promise<Resolved> {
  const dirs = (typeof options.dir === "string" ? [options.dir] : options.dir).map(normalizeDir);
  const multi = dirs.length > 1;
  if (multi) assertMultiDirTarget(options, dirs);
  const dir = multi ? "." : (dirs[0] ?? ".");
  const extraPaths = resolveExtraPaths(options, dirs);
  const workingDirectory = dir !== "." ? dir : undefined;

  const configPaths = dirs.map((d) => resolveConfigPath(options.outputDir, d));
  if (multi) assertDistinctConfigs(dirs, configPaths);
  const configPath = configPaths[0] ?? resolveConfigPath(options.outputDir, dir);

  const loadName = options.loadConfigName ?? defaultLoadConfigName;
  const workspaceName = options.workspaceName ?? (await loadName(configPath));
  if (!workspaceName) {
    throw new Error(
      "Could not determine the workspace name. " +
        "Pass --name, or set 'name' in tailor.config.ts.",
    );
  }
  validateWorkspaceName(workspaceName);

  const { kind } = options;
  const packageManager = detectPackageManager(options.outputDir);
  // The env-scoped TAILOR_PLATFORM_WORKSPACE_ID variable is only readable by a
  // job that declares `environment:`, so every plan/deploy job sets one. When
  // --environment is omitted it defaults to the workspace name.
  const environment = options.environment ?? workspaceName;
  validateEnvironment(environment);

  if (kind === "tag") {
    validateTagPattern(options.tagPattern);
  }

  let branch: string | null = null;
  let branchAutoDetected = false;
  let render: RenderResult;
  let erdNamespaces: string[] = [];
  let hasMigrations = false;
  let hasSeeds = false;
  const loadHasMigrations = options.loadHasMigrations ?? defaultLoadHasMigrations;
  const loadHasSeeds = options.loadHasSeeds ?? defaultLoadHasSeeds;
  const loadApps = async (checks: boolean): Promise<RenderApp[] | undefined> => {
    if (!multi) return undefined;
    return Promise.all(
      dirs.map(async (appDir, index) => {
        const appConfigPath = configPaths[index] ?? appDir;
        return checks
          ? {
              dir: appDir,
              migrationDriftCheck: await loadHasMigrations(appConfigPath),
              seedValidate: await loadHasSeeds(appConfigPath),
            }
          : { dir: appDir };
      }),
    );
  };
  let apps: RenderApp[] | undefined;

  const appErdNamespaces = new Map<string, string[]>();
  if (kind === "branch") {
    if (options.erdPreview) {
      const loadErdNamespaces = options.loadErdNamespaces ?? defaultLoadErdNamespaces;
      if (multi) {
        const owners = new Map<string, string>();
        for (const [index, appDir] of dirs.entries()) {
          const owned = await loadErdNamespaces(configPaths[index] ?? appDir);
          for (const namespace of owned) {
            const owner = owners.get(namespace);
            if (owner !== undefined) {
              throw new Error(
                `TailorDB namespace "${namespace}" is owned by both "${owner}" and "${appDir}". ` +
                  "A namespace is unique within a workspace: keep it in one app and reference it " +
                  "from the other with external: true.",
              );
            }
            owners.set(namespace, appDir);
          }
          appErdNamespaces.set(appDir, owned);
        }
        erdNamespaces = [...owners.keys()];
      } else {
        erdNamespaces = await loadErdNamespaces(configPath);
      }
      if (erdNamespaces.length === 0) {
        throw new Error(
          "No TailorDB namespaces found for --erd-preview. Define owned db namespaces in tailor.config.ts.",
        );
      }
      validateErdNamespaces(erdNamespaces);
    }
    branchAutoDetected = options.branch === undefined;
    branch =
      options.branch ?? detectDefaultBranch(options.outputDir, options.gitRunner, "--target");
    validateBranch(branch);
    apps = await loadApps(true);
    if (!apps) {
      hasMigrations = await loadHasMigrations(configPath);
      hasSeeds = await loadHasSeeds(configPath);
    }
    render = renderBranchWorkflow({
      workspaceName,
      branch,
      workingDirectory,
      apps,
      extraPaths,
      environment,
      packageManager,
      erdPreview: options.erdPreview ? { namespaces: erdNamespaces } : null,
      migrationDriftCheck: hasMigrations,
      seedValidate: hasSeeds,
      restrictDispatch: options.restrictDispatch ?? false,
    });
  } else if (kind === "tag") {
    branch = options.branch ?? null;
    if (branch !== null) {
      validateBranch(branch);
    }
    apps = await loadApps(true);
    if (!apps) {
      hasMigrations = await loadHasMigrations(configPath);
      hasSeeds = await loadHasSeeds(configPath);
    }
    render = renderTagWorkflow({
      workspaceName,
      tagPattern: options.tagPattern,
      branch: options.branch,
      workingDirectory,
      apps,
      environment,
      packageManager,
      migrationDriftCheck: hasMigrations,
      seedValidate: hasSeeds,
      restrictDispatch: options.restrictDispatch ?? false,
    });
  } else {
    branchAutoDetected = options.branch === undefined;
    branch = options.branch ?? detectDefaultBranch(options.outputDir, options.gitRunner);
    validateBranch(branch);
    validateRegion(options.region);
    apps = await loadApps(false);
    render = renderPreviewWorkflow({
      workspaceName,
      branch,
      workingDirectory,
      apps,
      extraPaths,
      environment,
      packageManager,
      region: options.region,
      requirePreviewLabel: options.requirePreviewLabel ?? false,
      includeDrafts: options.includeDrafts ?? false,
    });
  }

  // File name encodes the target kind so branch + tag + preview can coexist
  // under the same workspace name without colliding.
  const kindSuffix = kind === "tag" ? "-tag" : kind === "preview" ? "-preview" : "";
  const file = `.github/workflows/tailor-${workspaceName}${kindSuffix}.yml`;

  const inputs: LockInputs = {
    branch,
    branchAutoDetected: kind === "branch" || kind === "preview" ? branchAutoDetected : undefined,
    tagPattern: kind === "tag" ? options.tagPattern : null,
    environment,
    dir,
    packageManager,
    region: kind === "preview" ? options.region : undefined,
    requirePreviewLabel: kind === "preview" ? (options.requirePreviewLabel ?? false) : undefined,
    includeDrafts: kind === "preview" ? (options.includeDrafts ?? false) : undefined,
    erdPreview: kind === "branch" ? options.erdPreview : false,
    erdNamespaces: kind === "branch" && options.erdPreview ? erdNamespaces : undefined,
    apps:
      apps && appErdNamespaces.size > 0
        ? apps.map((app) => ({ ...app, erdNamespaces: appErdNamespaces.get(app.dir) ?? [] }))
        : apps,
    paths: extraPaths.length > 0 ? extraPaths : undefined,
    migrationDriftCheck: (kind === "branch" || kind === "tag") && !apps ? hasMigrations : undefined,
    seedValidate: (kind === "branch" || kind === "tag") && !apps ? hasSeeds : undefined,
    restrictDispatch:
      kind === "branch" || kind === "tag" ? (options.restrictDispatch ?? false) : undefined,
  };

  return {
    kind,
    workspaceName,
    branch,
    environment,
    packageManager,
    erdNamespaces,
    render,
    inputs,
    file,
    configPaths,
  };
}

type Decision =
  | { action: "create" }
  | { action: "restore" }
  | { action: "adopt" }
  | { action: "regenerate"; force: boolean }
  | { action: "conflict"; reason: string };

/**
 * Decide how to reconcile a target with the on-disk file and lock state.
 * @param obj - Decision inputs
 * @param obj.existing - The matching lock target, if any
 * @param obj.fileExists - Whether the workflow file is present on disk
 * @param obj.currentContent - On-disk content when present
 * @param obj.force - Whether --force was passed
 * @returns The reconciliation action
 */
export function decideAction(obj: {
  existing: LockTarget | undefined;
  fileExists: boolean;
  currentContent: string | null;
  force: boolean;
}): Decision {
  const { existing, fileExists, currentContent, force } = obj;

  if (!existing) {
    if (!fileExists) return { action: "create" };
    if (force) return { action: "adopt" };
    return {
      action: "conflict",
      reason:
        "An unmanaged workflow file already exists at this path. " +
        "Delete it, or pass --force to bring it under SDK management (this overwrites it).",
    };
  }

  if (!fileExists || currentContent === null) return { action: "restore" };
  const currentHash = currentContentHash(existing, currentContent);
  if (currentHash === null) {
    if (force) return { action: "adopt" };
    return {
      action: "conflict",
      reason:
        "This file is not valid YAML. Fix it, or re-run with --force to replace it with a fresh copy.",
    };
  }
  const [reservedId] = findReservedIds(currentContent, existing.generatedIds);
  if (reservedId !== undefined) {
    return { action: "conflict", reason: describeReservedId(reservedId) };
  }
  if (currentHash === existing.contentHash) return { action: "regenerate", force };
  if (force) return { action: "regenerate", force: true };
  return {
    action: "conflict",
    reason: isManagedHash(existing.contentHash)
      ? `${describeHandEdit("this file", editedPartsOf(existing, currentContent))} ` +
        "Revert those edits, or re-run with --force to reset them (your own jobs and steps are kept)."
      : "This file was generated by an older setup version, which compares the whole file, and " +
        "was edited since. Re-run with --force once to reset only the SDK-managed parts (your " +
        "own jobs and steps are kept).",
  };
}

/**
 * Compute the content to write for a target: the fresh render, with the
 * user-owned parts of the current file carried over when it is managed.
 * @param obj - Reconciliation inputs
 * @param obj.file - Repository-relative file path, for error messages
 * @param obj.decision - Reconciliation action from {@link decideAction}
 * @param obj.existing - The matching lock target, if any
 * @param obj.currentContent - On-disk content when present
 * @param obj.render - Fresh template render
 * @returns Content to write and the lock hash for it
 */
function reconcileContent(obj: {
  file: string;
  decision: Decision;
  existing: LockTarget | undefined;
  currentContent: string | null;
  render: RenderResult;
}): { content: string; contentHash: string; managedHashes: Record<string, string> } {
  const { file, decision, existing, currentContent, render } = obj;
  const contentHash = computeManagedHash(render.content, render.generatedIds);
  const managedHashes = computeManagedParts(render.content, render.generatedIds);
  if (decision.action !== "regenerate" || !existing || currentContent === null) {
    return { content: render.content, contentHash, managedHashes };
  }
  try {
    const merged = mergeUserContent({
      current: currentContent,
      rendered: render.content,
      previousIds: existing.generatedIds,
      renderedIds: render.generatedIds,
      force: decision.force,
    });
    if (merged.dropped.length > 0) {
      logger.warn(
        `${file}: dropped your steps ${merged.dropped.join(", ")} because the SDK no longer ` +
          "generates the job that contained them.",
      );
    }
    return { content: merged.content, contentHash, managedHashes };
  } catch (error) {
    if (error instanceof ManagedMergeError)
      throw new Error(`${file}: ${error.message}`, { cause: error });
    throw error;
  }
}

/**
 * Guard against two targets of different kinds colliding on the same file path.
 * @param obj - Conflict inputs
 * @param obj.lock - Existing lock file, or null
 * @param obj.kind - Target kind being generated
 * @param obj.workspaceName - Workspace name being generated
 * @param obj.file - Target file path
 */
function assertNoKindCollision(obj: {
  lock: LockFile | null;
  kind: TargetKind;
  workspaceName: string;
  file: string;
}): void {
  const { lock, kind, workspaceName, file } = obj;
  const collision = lock?.targets.find(
    (t) => t.file === file && !(t.kind === kind && t.workspaceName === workspaceName),
  );
  if (collision) {
    throw new Error(
      `A ${collision.kind} target already owns ${file}, which conflicts with this ${kind} target. ` +
        "Pass a different name with --name to generate a separate workflow.",
    );
  }
}

function printEnvironmentStep(environment: string): void {
  logger.log(
    `1. Set the secrets and variables the "${environment}" environment needs. ` +
      "This lists them and where each value comes from (drop --environment to list every " +
      "environment in .github/tailor.lock):",
  );
  logger.log(
    `   tailor setup ci env --environment ${environment}                       # gh commands`,
  );
  logger.log(
    `   tailor setup ci env --environment ${environment} --format terraform    # or Terraform`,
  );
}

export type SetupTargetResult = {
  kind: TargetKind;
  /** Repository-relative path of the generated workflow. */
  file: string;
  /** Resolved GitHub Environment name. */
  environment: string;
  /** Whether the app id was moved out of tailor.config.ts. */
  configEdited: boolean;
};

/**
 * Print next-step guidance after generating a deploy target.
 * @param result - What {@link setupTarget} generated
 */
export function printTargetNextSteps(result: SetupTargetResult): void {
  const { environment, configEdited } = result;

  logger.newline();
  logger.info("Next steps:");
  logger.newline();
  printEnvironmentStep(environment);

  logger.newline();
  logger.log("2. Commit the generated files:");
  logger.log("   - .github/workflows/tailor-*.yml");
  logger.log("   - .github/tailor.lock");
  if (configEdited) {
    logger.log(`   - tailor.config.ts (app id moved to ${TAILOR_LOCK_FILENAME})`);
  }
}

/**
 * Generate a deploy target workflow and reconcile it with the lock file.
 * @param options - Setup options
 * @returns What was generated, for {@link printTargetNextSteps}
 */
export async function setupTarget(options: SetupTargetOptions): Promise<SetupTargetResult> {
  const resolved = await resolve(options);

  const lock = readLock(options.outputDir);
  const absFile = path.join(options.outputDir, resolved.file);

  assertNoKindCollision({
    lock,
    kind: resolved.kind,
    workspaceName: resolved.workspaceName,
    file: resolved.file,
  });

  const existing = findTarget(lock, resolved.kind, resolved.workspaceName);
  const fileExists = fs.existsSync(absFile);
  const currentContent = fileExists ? fs.readFileSync(absFile, "utf-8") : null;

  const decision = decideAction({ existing, fileExists, currentContent, force: options.force });

  if (decision.action === "conflict") {
    throw new Error(`${resolved.file}: ${decision.reason}`);
  }

  // deploy resolves the app id against the nearest lock above the config, so
  // a lock between the config and this directory would take precedence over
  // the one written here.
  for (const configPath of resolved.configPaths) {
    const nearestLock = findAppIdLock(configPath);
    if (
      nearestLock !== null &&
      path.normalize(nearestLock.root) !== path.normalize(options.outputDir)
    ) {
      throw new Error(
        `${path.relative(options.outputDir, path.join(nearestLock.root, TAILOR_LOCK_FILENAME))} ` +
          "already governs the app id of this config. Run setup from that directory, or remove " +
          "that lock file if it is a leftover.",
      );
    }
  }

  // Planned before any file is written, so an app id conflict leaves the
  // workflow, the lock, and tailor.config.ts untouched.
  const loadConfigId = options.loadConfigId ?? defaultLoadConfigId;
  const appIdPlan = await planAppIds({
    lock: { root: options.outputDir, appIds: lock?.appIds ?? {} },
    entries: await Promise.all(
      resolved.configPaths.map(async (configPath) => ({
        configPath,
        configId: await loadConfigId(configPath),
      })),
    ),
    mode: "write",
  });

  const { content, contentHash, managedHashes } = reconcileContent({
    file: resolved.file,
    decision,
    existing,
    currentContent,
    render: resolved.render,
  });

  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, content, "utf-8");

  const newTarget: LockTarget = {
    kind: resolved.kind,
    workspaceName: resolved.workspaceName,
    file: resolved.file,
    templateVersion: TEMPLATE_VERSION,
    inputs: resolved.inputs,
    generatedIds: resolved.render.generatedIds,
    contentHash,
    managedHashes,
  };

  // Replace in place to keep the lock diff minimal when re-running setup for
  // one of several targets.
  const targets = [...(lock?.targets ?? [])];
  const index = targets.findIndex(
    (t) => t.kind === newTarget.kind && t.workspaceName === newTarget.workspaceName,
  );
  if (index === -1) {
    targets.push(newTarget);
  } else {
    targets[index] = newTarget;
  }
  writeLock(options.outputDir, {
    ...lock,
    version: LOCK_VERSION,
    targets,
    appIds: appIdPlan.appIds,
  });
  const { configEdited } = await removeAdoptedConfigIds(appIdPlan);

  if (decision.action === "restore") {
    logger.success(`Regenerated ${styles.path(resolved.file)} (was missing on disk)`);
  } else if (decision.action === "regenerate" || decision.action === "adopt") {
    logger.success(`Regenerated ${styles.path(resolved.file)}`);
  } else {
    logger.success(`Generated ${styles.path(resolved.file)}`);
  }

  return {
    kind: resolved.kind,
    file: resolved.file,
    environment: resolved.environment,
    configEdited,
  };
}
