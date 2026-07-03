import * as fs from "node:fs";
import * as path from "pathe";
import { ensureConfigId } from "#/cli/commands/deploy/config-id-injector";
import { logBetaWarning } from "#/cli/shared/beta";
import { extractOwnedNamespaces } from "#/cli/shared/config";
import { loadConfig } from "#/cli/shared/config-loader";
import { logger, styles } from "#/cli/shared/logger";
import { getNamespacesWithMigrations } from "../tailordb/migrate/config";
import { detectDefaultBranch, type GitRunner } from "./git";
import {
  findTarget,
  hashContent,
  LOCK_VERSION,
  readLock,
  writeLock,
  type LockFile,
  type LockInputs,
  type LockTarget,
  type TargetKind,
} from "./lock";
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
};

export type TagSetupOptions = CommonSetupOptions & {
  kind: "tag";
  tagPattern: string;
  branch?: string;
};

export type PreviewSetupOptions = CommonSetupOptions & {
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

export type ActionSetupOptions = CommonSetupOptions & {
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
  /** Action names (without tailor- prefix), in deploy order. */
  actions: string[];
  branch?: string;
  tagPattern?: string;
  environment?: string;
  force: boolean;
  outputDir: string;
  /** Injectable git runner, for testing. */
  gitRunner?: GitRunner;
};

async function defaultLoadConfigName(configPath: string): Promise<string | undefined> {
  const { config } = await loadConfig(configPath);
  return config.name;
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

// Kept in sync with the `workspace create` schema (cli/commands/workspace/create.ts).
// The name is used as the plan label, the generated file name, and the default
// GitHub Environment name, so it must stay within the workspace-name charset.
const WORKSPACE_NAME_RE = /^[a-z0-9-]+$/;

function validateWorkspaceName(name: string): void {
  if (
    name.length < 3 ||
    name.length > 63 ||
    !WORKSPACE_NAME_RE.test(name) ||
    name.startsWith("-") ||
    name.endsWith("-")
  ) {
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
 * `paths:` filters and the config under it gets mutated (id injection), so
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
    branch = options.branch ?? detectDefaultBranch(options.outputDir, options.gitRunner);
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
  | { action: "regenerate" }
  | { action: "restore" }
  | { action: "conflict"; reason: string };

// Matches the user-editable run: body under the build-site step. Used to
// normalise the content before hashing so that custom build commands do not
// trigger false hand-edit drift.
const BUILD_SITE_RUN_RE =
  /([ \t]*- id: build-site\n[ \t]+shell: bash\n[ \t]+run: \|)([\s\S]*?)(\n[ \t]*- |\n*$)/;

/**
 * Strip the mutable run: body of the build-site step before hashing.
 * When hasStaticWebsites is true the step is present; users are expected to
 * replace the placeholder command with their actual build command.  We only
 * hash the structural parts (step id, shell declaration, run: key) so that
 * editing the build command does not look like unintended drift.
 * When hasStaticWebsites is false the step is absent, so the regex is a no-op.
 * @param content - Raw action workflow content
 * @returns Normalised content with the build-site run body replaced by a placeholder
 */
export function normalizeActionContent(content: string): string {
  return content.replace(
    BUILD_SITE_RUN_RE,
    (_, header, _body, tail) => `${header}\n        true${tail}`,
  );
}

/**
 * Extract the run: body of the build-site step from action content.
 * Returns null when the step is absent (hasStaticWebsites is false).
 * @param content - Action workflow content
 * @returns The captured run body string (includes leading newline), or null
 */
function extractBuildSiteRunBody(content: string): string | null {
  const m = BUILD_SITE_RUN_RE.exec(content);
  return m ? (m[2] ?? null) : null;
}

/**
 * Replace the run: body of the build-site step in action content.
 * No-op when the step is absent.
 * @param content - Target action workflow content
 * @param body - Run body to inject (includes leading newline and indentation)
 * @returns Content with the run body replaced
 */
function injectBuildSiteRunBody(content: string, body: string): string {
  return content.replace(
    BUILD_SITE_RUN_RE,
    (_, header, _placeholder, tail) => `${header}${body}${tail}`,
  );
}

/**
 * Decide how to reconcile a target with the on-disk file and lock state.
 * @param obj - Decision inputs
 * @param obj.existing - The matching lock target, if any
 * @param obj.fileExists - Whether the workflow file is present on disk
 * @param obj.currentContent - On-disk content when present
 * @param obj.force - Whether --force was passed
 * @param obj.normalize - Optional content normaliser applied before hashing
 * @returns The reconciliation action
 */
export function decideAction(obj: {
  existing: LockTarget | undefined;
  fileExists: boolean;
  currentContent: string | null;
  force: boolean;
  normalize?: (content: string) => string;
}): Decision {
  const { existing, fileExists, currentContent, force, normalize } = obj;

  if (!existing) {
    if (!fileExists) return { action: "create" };
    if (force) return { action: "regenerate" };
    return {
      action: "conflict",
      reason:
        "An unmanaged workflow file already exists at this path. " +
        "Delete it, or pass --force to bring it under SDK management (this overwrites it).",
    };
  }

  // Lock has this target.
  if (!fileExists) return { action: "restore" };
  if (currentContent !== null) {
    const normalizedContent = normalize ? normalize(currentContent) : currentContent;
    if (hashContent(normalizedContent) === existing.contentHash) {
      return { action: "regenerate" };
    }
  }
  if (force) return { action: "regenerate" };
  return {
    action: "conflict",
    reason:
      "This workflow file has been edited by hand since it was generated. " +
      "Re-run with --force to discard those edits and regenerate, or revert your changes.",
  };
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
 * @param obj.idInjected - Whether an app id was injected into the config
 */
function printNextSteps(obj: { environment: string; idInjected: boolean }): void {
  const { environment, idInjected } = obj;

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
  if (idInjected) {
    logger.log("   - tailor.config.ts (app id was added)");
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

  const normalize = resolved.kind === "action" ? normalizeActionContent : undefined;
  const decision = decideAction({
    existing,
    fileExists,
    currentContent,
    force: options.force,
    normalize,
  });

  if (decision.action === "conflict") {
    throw new Error(`${resolved.file}: ${decision.reason}`);
  }

  // Inject the app id only after reconciliation has ruled out conflicts, so
  // validation failures leave tailor.config.ts untouched (later filesystem
  // errors can still occur after injection).
  const idResult = await ensureConfigId(resolved.configPath);
  if (idResult === null) {
    logger.warn(
      "Could not find a defineConfig() call to confirm an app id. " +
        "The CI deploy will fail unless your config resolves to one with an 'id'.",
    );
  }
  const idInjected = idResult?.injected ?? false;

  // For action targets, preserve the user-editable build-site run body when
  // regenerating (hash matched after normalization) so that custom build commands
  // survive non-forced reruns without being silently overwritten.
  let contentToWrite = resolved.render.content;
  if (decision.action === "regenerate" && normalize && currentContent !== null) {
    const existingBody = extractBuildSiteRunBody(currentContent);
    if (existingBody !== null) {
      contentToWrite = injectBuildSiteRunBody(contentToWrite, existingBody);
    }
  }

  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, contentToWrite, "utf-8");

  const newTarget: LockTarget = {
    kind: resolved.kind,
    workspaceName: resolved.workspaceName,
    file: resolved.file,
    templateVersion: TEMPLATE_VERSION,
    inputs: resolved.inputs,
    generatedIds: resolved.render.generatedIds,
    ejectedIds: existing?.ejectedIds ?? [],
    contentHash: hashContent(
      normalize ? normalize(resolved.render.content) : resolved.render.content,
    ),
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
  writeLock(options.outputDir, { version: LOCK_VERSION, targets });

  if (decision.action === "restore") {
    logger.success(`Regenerated ${styles.path(resolved.file)} (was missing on disk)`);
  } else if (decision.action === "regenerate") {
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
      "Use `tailor setup coordinate` to generate a coordinator workflow that orchestrates this action.",
    );
  } else {
    printNextSteps({ environment: resolved.environment, idInjected });
  }
}

/**
 * Generate the coordinator workflow that orchestrates per-app composite actions.
 *
 * Unlike `setupTarget`, this function does not read a Tailor config. The coordinator
 * name is required via `--name`. App working directories are resolved from
 * the lock file entries created by `setup action`.
 * @param options - Coordinate setup options
 */
export async function setupCoordinate(options: CoordinateSetupOptions): Promise<void> {
  logBetaWarning("setup");

  const { coordinatorName, coordinateKind, actions, force, outputDir } = options;
  validateWorkspaceName(coordinatorName);

  if (actions.length === 0) {
    throw new Error(
      "At least one --action is required. " +
        "Run `tailor setup action --dir <app-dir>` for each app first.",
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
        "Run `tailor setup action --name <name>` for each app before running setup coordinate.",
    );
  }

  // Resolve each action name to its lock entry to get the working directory.
  const seenNames = new Set<string>();
  const apps: CoordinateApp[] = actions.map((actionName) => {
    const name = actionName.startsWith("tailor-") ? actionName.slice("tailor-".length) : actionName;
    if (seenNames.has(name)) {
      throw new Error(
        `Duplicate --action "${name}". Each composite action can only appear once in a coordinator.`,
      );
    }
    seenNames.add(name);
    const entry = lock.targets.find((t) => t.kind === "action" && t.workspaceName === name);
    if (!entry) {
      throw new Error(
        `Action target "${name}" not found in .github/tailor.lock. ` +
          `Run \`tailor setup action --name ${name}\` first.`,
      );
    }
    validateDir(entry.inputs.dir);
    return { name, dir: entry.inputs.dir };
  });

  const render = renderCoordinateWorkflow({
    coordinatorName,
    kind: coordinateKind,
    apps,
    branch: branch ?? undefined,
    tagPattern: coordinateKind === "tag" ? tagPattern : undefined,
    environment,
    packageManager,
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

  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, render.content, "utf-8");

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
      actionDirs: apps.map((a) => a.dir),
    },
    generatedIds: render.generatedIds,
    ejectedIds: existing?.ejectedIds ?? [],
    contentHash: hashContent(render.content),
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
  writeLock(outputDir, { version: LOCK_VERSION, targets });

  if (decision.action === "restore") {
    logger.success(`Regenerated ${styles.path(file)} (was missing on disk)`);
  } else if (decision.action === "regenerate") {
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
    `2. Provision each workspace and set TAILOR_PLATFORM_WORKSPACE_ID on the "${environment}" environment:`,
  );
  logger.log("   tailor workspace create   # one per app; copy the id");
  logger.log(`   gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env ${environment}`);
  logger.newline();
  logger.log("3. Commit the generated files:");
  logger.log(`   - ${file}`);
  logger.log(`   - ${tailorSetupFile}  (if newly created)`);
  logger.log("   - .github/tailor.lock");
}
