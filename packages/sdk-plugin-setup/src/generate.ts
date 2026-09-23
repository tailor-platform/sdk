import * as fs from "node:fs";
import {
  logBetaWarning,
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
  currentContentHash,
  isManagedHash,
  layoutOf,
  ManagedMergeError,
  mergeUserContent,
} from "./managed";
import {
  detectPackageManager,
  renderActionWorkflow,
  renderBranchWorkflow,
  renderCoordinateWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  renderTailorSetupAction,
  TEMPLATE_VERSION,
  type CoordinateApp,
  type CoordinateAppGroup,
  type CoordinateKind,
  type PackageManager,
  type RenderResult,
} from "./templates";

type CommonSetupOptions = {
  workspaceName?: string;
  dir: string;
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
  /** Injectable static website detector, for testing. Defaults to loading the config. */
  loadHasStaticWebsites?: (configPath: string) => Promise<boolean>;
};

export type BranchSetupOptions = CommonSetupOptions & {
  kind: "branch";
  branch?: string;
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
  /** Workspace region for preview workspace creation (e.g. `us-west`). */
  region: string;
  /**
   * When true, the preview workflow deploys only for PRs labeled `tailor:preview`.
   * Default false: preview deploys on every PR.
   */
  requirePreviewLabel?: boolean;
};

type ActionSetupOptions = CommonSetupOptions & {
  kind: "action";
};

export type SetupTargetOptions =
  | BranchSetupOptions
  | TagSetupOptions
  | PreviewSetupOptions
  | ActionSetupOptions;

export type CoordinateSetupOptions = {
  coordinatorName: string;
  coordinateKind: CoordinateKind;
  /** Action names or comma-separated action groups (without tailor- prefix), in deploy order. */
  actions: string[];
  branch?: string;
  tagPattern?: string;
  environment?: string;
  restrictDispatch?: boolean;
  force: boolean;
  outputDir: string;
  /** Injectable git runner, for testing. */
  gitRunner?: GitRunner;
};

function actionName(input: string): string {
  return input.startsWith("tailor-") ? input.slice("tailor-".length) : input;
}

function splitActionGroup(input: string): string[] {
  const names = input.split(",").map((entry) => actionName(entry.trim()));
  if (names.some((name) => name.length === 0)) {
    throw new Error("--action must contain one or more non-empty action names.");
  }
  return names;
}

function uniqueGroupId(names: readonly string[], usedIds: Set<string>): string {
  const base = names.join("-");
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

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

async function defaultLoadHasStaticWebsites(configPath: string): Promise<boolean> {
  const { config } = await loadConfig(configPath);
  return (config.staticWebsites?.length ?? 0) > 0;
}

// The name is used as the plan label, the generated file name, and the default
// GitHub Environment name, so it must stay within the workspace-name charset.
function validateWorkspaceName(name: string): void {
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

function validateEnvironment(environment: string): void {
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
  configPath: string;
};

/**
 * Resolve all derived values and render the workflow content.
 * @param options - Setup options
 * @returns Resolved target metadata and rendered content
 */
async function resolve(options: SetupTargetOptions): Promise<Resolved> {
  // Normalize before any filesystem use and before embedding into workflow
  // YAML (paths filters / working-directory): POSIX separators, collapse
  // duplicate slashes, drop a leading "./" and trailing "/" so values like
  // "./apps/backend/" produce a clean "apps/backend".
  const dir =
    options.dir
      .replaceAll("\\", "/")
      .replace(/\/{2,}/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/$/, "") || ".";
  validateDir(dir);
  const workingDirectory = dir !== "." ? dir : undefined;

  const configPath = resolveConfigPath(options.outputDir, dir);

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
  let hasStaticWebsites = false;
  const loadHasMigrations = options.loadHasMigrations ?? defaultLoadHasMigrations;
  const loadHasSeeds = options.loadHasSeeds ?? defaultLoadHasSeeds;
  const loadHasStaticWebsites = options.loadHasStaticWebsites ?? defaultLoadHasStaticWebsites;

  if (kind === "branch") {
    if (options.erdPreview) {
      const loadErdNamespaces = options.loadErdNamespaces ?? defaultLoadErdNamespaces;
      erdNamespaces = await loadErdNamespaces(configPath);
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
    hasMigrations = await loadHasMigrations(configPath);
    hasSeeds = await loadHasSeeds(configPath);
    render = renderBranchWorkflow({
      workspaceName,
      branch,
      workingDirectory,
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
    hasMigrations = await loadHasMigrations(configPath);
    hasSeeds = await loadHasSeeds(configPath);
    render = renderTagWorkflow({
      workspaceName,
      tagPattern: options.tagPattern,
      branch: options.branch,
      workingDirectory,
      environment,
      packageManager,
      migrationDriftCheck: hasMigrations,
      seedValidate: hasSeeds,
      restrictDispatch: options.restrictDispatch ?? false,
    });
  } else if (kind === "preview") {
    branchAutoDetected = options.branch === undefined;
    branch = options.branch ?? detectDefaultBranch(options.outputDir, options.gitRunner);
    validateBranch(branch);
    validateRegion(options.region);
    render = renderPreviewWorkflow({
      workspaceName,
      branch,
      workingDirectory,
      environment,
      packageManager,
      region: options.region,
      requirePreviewLabel: options.requirePreviewLabel ?? false,
    });
  } else {
    // action — no branch detection, no package-manager embedding (caller installs)
    hasStaticWebsites = await loadHasStaticWebsites(configPath);
    render = renderActionWorkflow({ workspaceName, workingDirectory, hasStaticWebsites });
  }

  // File name encodes the target kind so branch + tag + preview can coexist
  // under the same workspace name without colliding.
  const kindSuffix = kind === "tag" ? "-tag" : kind === "preview" ? "-preview" : "";
  const file =
    kind === "action"
      ? `.github/actions/tailor-${workspaceName}/action.yml`
      : `.github/workflows/tailor-${workspaceName}${kindSuffix}.yml`;

  const inputs: LockInputs = {
    branch: kind === "action" ? null : branch,
    branchAutoDetected: kind === "branch" || kind === "preview" ? branchAutoDetected : undefined,
    tagPattern: kind === "tag" ? options.tagPattern : null,
    environment,
    dir,
    packageManager,
    region: kind === "preview" ? options.region : undefined,
    requirePreviewLabel: kind === "preview" ? (options.requirePreviewLabel ?? false) : undefined,
    erdPreview: kind === "branch" ? options.erdPreview : false,
    erdNamespaces: kind === "branch" && options.erdPreview ? erdNamespaces : undefined,
    migrationDriftCheck: kind === "branch" || kind === "tag" ? hasMigrations : undefined,
    seedValidate: kind === "branch" || kind === "tag" ? hasSeeds : undefined,
    hasStaticWebsites: kind === "action" ? hasStaticWebsites : undefined,
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
    configPath,
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
  if (currentHash === existing.contentHash) return { action: "regenerate", force: false };
  if (currentHash === null) {
    if (force) return { action: "adopt" };
    return {
      action: "conflict",
      reason:
        "This file is not valid YAML. Fix it, or re-run with --force to replace it with a fresh copy.",
    };
  }
  if (force) return { action: "regenerate", force: true };
  return {
    action: "conflict",
    reason: isManagedHash(existing.contentHash)
      ? "SDK-managed parts of this file (tailor-* jobs/steps or top-level keys) were edited by hand. " +
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
 * @param obj.kind - Target kind
 * @param obj.decision - Reconciliation action from {@link decideAction}
 * @param obj.existing - The matching lock target, if any
 * @param obj.currentContent - On-disk content when present
 * @param obj.render - Fresh template render
 * @returns Content to write and the lock hash for it
 */
function reconcileContent(obj: {
  file: string;
  kind: TargetKind;
  decision: Decision;
  existing: LockTarget | undefined;
  currentContent: string | null;
  render: RenderResult;
}): { content: string; contentHash: string } {
  const { file, kind, decision, existing, currentContent, render } = obj;
  const layout = layoutOf(kind);
  const contentHash = computeManagedHash(render.content, layout, render.generatedIds);
  if (decision.action !== "regenerate" || !existing || currentContent === null) {
    return { content: render.content, contentHash };
  }
  try {
    const merged = mergeUserContent({
      current: currentContent,
      rendered: render.content,
      layout,
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
    return { content: merged.content, contentHash };
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

/**
 * Print next-step guidance after generating workflow files.
 * @param obj - Output context
 * @param obj.environment - Resolved GitHub Environment name for this target
 * @param obj.configEdited - Whether the app id was moved out of the config
 */
function printNextSteps(obj: { environment: string; configEdited: boolean }): void {
  const { environment, configEdited } = obj;

  logger.newline();
  logger.info("Next steps:");
  logger.newline();
  logger.log(`1. Set the machine-user credentials as secrets on the "${environment}" environment:`);
  logger.log(`   gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env ${environment}`);
  logger.log(`   gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env ${environment}`);

  logger.newline();
  logger.log(
    `2. Provision the workspace and set its id as the TAILOR_PLATFORM_WORKSPACE_ID variable ` +
      `on the "${environment}" environment:`,
  );
  logger.log("   tailor workspace create   # if it does not exist yet; copy the id");
  logger.log(`   gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env ${environment}`);

  logger.newline();
  logger.log("3. Commit the generated files:");
  logger.log("   - .github/workflows/tailor-*.yml");
  logger.log("   - .github/tailor.lock");
  if (configEdited) {
    logger.log(`   - tailor.config.ts (app id moved to ${TAILOR_LOCK_FILENAME})`);
  }
}

/**
 * Generate a deploy target workflow and reconcile it with the lock file.
 * @param options - Setup options
 */
export async function setupTarget(options: SetupTargetOptions): Promise<void> {
  logBetaWarning("setup");

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
  const nearestLock = findAppIdLock(resolved.configPath);
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

  // Planned before any file is written, so an app id conflict leaves the
  // workflow, the lock, and tailor.config.ts untouched.
  const loadConfigId = options.loadConfigId ?? defaultLoadConfigId;
  const appIdPlan = await planAppIds({
    lock: { root: options.outputDir, appIds: lock?.appIds ?? {} },
    entries: [
      { configPath: resolved.configPath, configId: await loadConfigId(resolved.configPath) },
    ],
    mode: "write",
  });

  const { content, contentHash } = reconcileContent({
    file: resolved.file,
    kind: resolved.kind,
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
    ejectedIds: existing?.ejectedIds ?? [],
    contentHash,
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

  if (resolved.kind === "action") {
    logger.newline();
    logger.info("Next steps:");
    logger.newline();
    logger.log(`The composite action has been generated at ${styles.path(resolved.file)}.`);
    logger.log(
      "Use `tailor setup ci coordinate` to generate a coordinator workflow that orchestrates this action.",
    );
    logger.log(`Commit ${TAILOR_LOCK_FILENAME} alongside it: it records this app's id.`);
    if (configEdited) {
      logger.log("The app id was moved out of tailor.config.ts; commit that change too.");
    }
  } else {
    printNextSteps({ environment: resolved.environment, configEdited });
  }
}

/**
 * Generate the coordinator workflow that orchestrates per-app composite actions.
 *
 * Unlike `setupTarget`, this function does not read a Tailor config. The coordinator
 * name is required via `--name`. App working directories are resolved from
 * the lock file entries created by `setup ci action`.
 * @param options - Coordinate setup options
 */
export async function setupCoordinate(options: CoordinateSetupOptions): Promise<void> {
  logBetaWarning("setup");

  const { coordinatorName, coordinateKind, actions, force, outputDir } = options;
  validateWorkspaceName(coordinatorName);

  if (actions.length === 0) {
    throw new Error(
      "At least one --action is required. " +
        "Run `tailor setup ci action --dir <app-dir>` for each app first.",
    );
  }

  const environment = options.environment ?? coordinatorName;
  validateEnvironment(environment);

  let branch: string | null = null;
  let branchAutoDetected = false;
  if (coordinateKind === "branch") {
    branchAutoDetected = options.branch === undefined;
    branch = options.branch ?? detectDefaultBranch(outputDir, options.gitRunner);
    validateBranch(branch);
  } else if (options.branch !== undefined) {
    validateBranch(options.branch);
    branch = options.branch;
  }

  const tagPattern = options.tagPattern ?? "v*";
  if (coordinateKind === "tag") {
    validateTagPattern(tagPattern);
  }

  const packageManager = detectPackageManager(outputDir);
  const lock = readLock(outputDir);

  if (!lock) {
    throw new Error(
      ".github/tailor.lock not found. " +
        "Run `tailor setup ci action --name <name>` for each app before running setup ci coordinate.",
    );
  }

  const actionTargets = new Map(
    lock.targets.filter((t) => t.kind === "action").map((target) => [target.workspaceName, target]),
  );

  // Resolve each action name to its lock entry to get the working directory.
  const seenNames = new Set<string>();
  const usedGroupIds = new Set<string>();
  const actionGroups: CoordinateAppGroup[] = actions.map((actionGroup) => {
    const names = splitActionGroup(actionGroup);
    const apps: CoordinateApp[] = names.map((name) => {
      if (seenNames.has(name)) {
        throw new Error(
          `Duplicate --action "${name}". Each composite action can only appear once in a coordinator.`,
        );
      }
      seenNames.add(name);
      const entry = actionTargets.get(name);
      if (!entry) {
        throw new Error(
          `Action target "${name}" not found in .github/tailor.lock. ` +
            `Run \`tailor setup ci action --name ${name}\` first.`,
        );
      }
      if (names.length > 1 && entry.templateVersion < TEMPLATE_VERSION) {
        throw new Error(
          `Action target "${name}" was generated with an older setup template. ` +
            `Run \`tailor setup ci action --name ${name} --force\` before grouping it in setup ci coordinate.`,
        );
      }
      validateDir(entry.inputs.dir);
      return {
        name,
        dir: entry.inputs.dir,
        hasStaticWebsites: entry.inputs.hasStaticWebsites,
      };
    });
    return { id: uniqueGroupId(names, usedGroupIds), apps };
  });

  const render = renderCoordinateWorkflow({
    coordinatorName,
    kind: coordinateKind,
    actionGroups,
    branch: branch ?? undefined,
    tagPattern: coordinateKind === "tag" ? tagPattern : undefined,
    environment,
    packageManager,
    restrictDispatch: options.restrictDispatch ?? false,
  });

  const kindSuffix = coordinateKind === "tag" ? "-tag" : "";
  const file = `.github/workflows/tailor-coordinate-${coordinatorName}${kindSuffix}.yml`;
  const absFile = path.join(outputDir, file);

  assertNoKindCollision({ lock, kind: "coordinate", workspaceName: coordinatorName, file });

  const existing = findTarget(lock, "coordinate", coordinatorName);
  const fileExists = fs.existsSync(absFile);
  const currentContent = fileExists ? fs.readFileSync(absFile, "utf-8") : null;

  const decision = decideAction({ existing, fileExists, currentContent, force });
  if (decision.action === "conflict") {
    throw new Error(`${file}: ${decision.reason}`);
  }

  const { content, contentHash } = reconcileContent({
    file,
    kind: "coordinate",
    decision,
    existing,
    currentContent,
    render,
  });

  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, content, "utf-8");

  // Generate the local tailor-setup action (user-owned: created once, never overwritten).
  const tailorSetupFile = ".github/actions/tailor-setup/action.yml";
  const absTailorSetupFile = path.join(outputDir, tailorSetupFile);
  if (!fs.existsSync(absTailorSetupFile)) {
    fs.mkdirSync(path.dirname(absTailorSetupFile), { recursive: true });
    fs.writeFileSync(absTailorSetupFile, renderTailorSetupAction({ packageManager }), "utf-8");
    logger.success(`Generated ${styles.path(tailorSetupFile)}`);
  }

  const newTarget: LockTarget = {
    kind: "coordinate",
    workspaceName: coordinatorName,
    file,
    templateVersion: TEMPLATE_VERSION,
    inputs: {
      branch,
      branchAutoDetected:
        coordinateKind === "branch" ? branchAutoDetected : branch !== null ? false : undefined,
      tagPattern: coordinateKind === "tag" ? tagPattern : null,
      environment,
      dir: ".",
      packageManager,
      actionDirs: actionGroups.flatMap((group) => group.apps.map((a) => a.dir)),
      restrictDispatch: options.restrictDispatch ?? false,
    },
    generatedIds: render.generatedIds,
    ejectedIds: existing?.ejectedIds ?? [],
    contentHash,
  };

  const targets = [...lock.targets];
  const idx = targets.findIndex(
    (t) => t.kind === newTarget.kind && t.workspaceName === newTarget.workspaceName,
  );
  if (idx === -1) {
    targets.push(newTarget);
  } else {
    targets[idx] = newTarget;
  }
  writeLock(outputDir, { ...lock, version: LOCK_VERSION, targets });

  if (decision.action === "restore") {
    logger.success(`Regenerated ${styles.path(file)} (was missing on disk)`);
  } else if (decision.action === "regenerate" || decision.action === "adopt") {
    logger.success(`Regenerated ${styles.path(file)}`);
  } else {
    logger.success(`Generated ${styles.path(file)}`);
  }

  logger.newline();
  logger.info("Next steps:");
  logger.newline();
  logger.log(`1. Set the machine-user credentials as secrets on the "${environment}" environment:`);
  logger.log(`   gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env ${environment}`);
  logger.log(`   gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env ${environment}`);
  logger.newline();
  logger.log(
    `2. Provision the target workspace and set TAILOR_PLATFORM_WORKSPACE_ID on the "${environment}" environment:`,
  );
  logger.log("   tailor workspace create   # if it does not exist yet; copy the id");
  logger.log(`   gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env ${environment}`);
  logger.newline();
  logger.log("3. Commit the generated files:");
  logger.log(`   - ${file}`);
  logger.log(`   - ${tailorSetupFile}  (if newly created)`);
  logger.log("   - .github/tailor.lock");
}
