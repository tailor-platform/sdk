import { logger } from "@tailor-platform/sdk/cli";
import {
  describeGroup,
  type EnvRequirement,
  type EnvironmentRequirements,
  loadEnvironmentRequirements,
  renderGhCommands,
  SECRET_FALLBACK_VARIABLES,
} from "./env";
import { defaultGhRunner, type GhOutput, type GhRunner, parseRepoView, REPO_VIEW_ARGS } from "./gh";
import { detectRepository, GITHUB_HOST, type GitRunner, type Repository } from "./git";

const GH_AUTH_REQUIRED_EXIT = 4;

type EntryType = EnvRequirement["type"];

type Names = Record<EntryType, Set<string>>;

/** Where a workflow job resolves `secrets.X` / `vars.X` from, in GitHub's precedence order. */
type Scope = "environment" | "repository" | "organization";

type ScopedNames = { scope: Scope; names: Names };

type RequirementCheck = EnvRequirement & {
  /** Whether the workflow finds a value, counting the deprecated secret fallback. */
  registered: boolean;
  /** Scope GitHub resolves the entry from; null when no scope has it. */
  foundIn: Scope | null;
  /** Scope holding an entry of the same name but the other type; null when none does. */
  otherTypeIn: Scope | null;
};

type EnvironmentCheck = Omit<EnvironmentRequirements, "requirements"> & {
  exists: boolean;
  requirements: RequirementCheck[];
};

const OTHER_TYPE = { secret: "variable", variable: "secret" } as const;

function checkRequirement(requirement: EnvRequirement, scopes: ScopedNames[]): RequirementCheck {
  const scopeHolding = (type: EntryType) =>
    scopes.find(({ names }) => names[type].has(requirement.name))?.scope ?? null;
  const foundIn = scopeHolding(requirement.type);
  const otherTypeIn = foundIn === null ? scopeHolding(OTHER_TYPE[requirement.type]) : null;
  const fallback =
    requirement.type === "variable" && SECRET_FALLBACK_VARIABLES.has(requirement.name);
  return {
    ...requirement,
    registered: foundIn !== null || (fallback && otherTypeIn !== null),
    foundIn,
    otherTypeIn,
  };
}

/**
 * Check which secrets and variables the generated workflows need are registered in GitHub.
 * @param options - Check options
 * @param options.outputDir - Repository root where `.github` lives
 * @param options.environments - Only check these environments; all when empty
 * @param options.gitRunner - Injectable git runner, for testing
 * @param options.ghRunner - Injectable gh runner, for testing
 */
export function checkEnv(options: {
  outputDir: string;
  environments?: string[];
  gitRunner?: GitRunner;
  ghRunner?: GhRunner;
}): void {
  const environments = loadEnvironmentRequirements(options.outputDir, options.environments);
  const repository = detectRepository(options.outputDir, options.gitRunner);
  const runGh = options.ghRunner ?? defaultGhRunner;
  const gh = (args: string[]): GhOutput => {
    const result = runGh(args, options.outputDir);
    if (result === null) {
      throw new Error(
        "The GitHub CLI (gh) is not installed. Install it from https://cli.github.com, " +
          "then run `gh auth login`.",
      );
    }
    if (result.status === GH_AUTH_REQUIRED_EXIT || httpStatus(result) === 401) {
      throw new Error(
        `gh is not logged in to GitHub, or its token is invalid (${ghMessage(result)}). ` +
          "Run `gh auth login`, or set GH_TOKEN to a valid token.",
      );
    }
    return result;
  };

  const target = repository ?? resolveRepository(gh);
  const path = `${target.owner}/${target.name}`;
  // `gh api` sends every request to its default host, not to the host of the repository it
  // resolves from the current directory.
  const ghApi = (args: string[]) => gh(["api", "--hostname", target.host ?? GITHUB_HOST, ...args]);

  const repoResult = ghApi([`repos/${path}`]);
  if (httpStatus(repoResult) === 404) {
    throw new Error(
      `Repository ${path} was not found, or the gh account has no access to it: GitHub ` +
        "answers 404 for a private repository the account cannot see. Run `gh auth status` to " +
        "check which account gh uses; it needs write access to the repository.",
    );
  }
  if (repoResult.status !== 0) {
    throw new Error(`Repository ${path} could not be read: ${ghMessage(repoResult)}`);
  }
  const repo = JSON.parse(repoResult.stdout) as {
    full_name?: string;
    owner?: { type?: string };
    permissions?: Record<string, boolean>;
  };
  const fullName = repo.full_name ?? path;
  // GitHub refuses every list endpoint below the write role.
  const { permissions } = repo;
  if (permissions?.push === false) {
    const granted = Object.keys(permissions).filter((name) => permissions[name]);
    throw new Error(
      `Listing secrets and variables needs the push (write) permission on ${fullName}, but the ` +
        `gh account only has: ${granted.join(", ") || "none"}. Ask a repository admin for write ` +
        "access, or run the check as an account that has it.",
    );
  }

  const listNames = (path: string, type: EntryType, what: string): Set<string> => {
    const result = ghApi(["--paginate", `${path}?per_page=100`, "--jq", `.${type}s[].name`]);
    if (result.status !== 0) {
      throw new Error(
        httpStatus(result) === 403
          ? `GitHub denied listing the ${what} of ${fullName}: ${ghMessage(result)}. The token gh ` +
              "uses needs read access to the repository's secrets and variables: the repo scope " +
              "for a classic token, or the Secrets, Variables, and Environments permissions for " +
              "a fine-grained one."
          : `Could not list the ${what} of ${fullName}: ${ghMessage(result)}`,
      );
    }
    return new Set(result.stdout.split("\n").filter((name) => name !== ""));
  };
  const listScope = (
    paths: Record<EntryType, string>,
    describe: (entries: "secrets" | "variables") => string,
  ): Names => ({
    secret: listNames(paths.secret, "secret", describe("secrets")),
    variable: listNames(paths.variable, "variable", describe("variables")),
  });

  const actions = `repos/${path}/actions`;
  const repositoryScopes: ScopedNames[] = [
    {
      scope: "repository",
      names: listScope(
        { secret: `${actions}/secrets`, variable: `${actions}/variables` },
        (entries) => `repository ${entries}`,
      ),
    },
  ];
  // Only organization repositories can use organization-level entries; GitHub rejects the
  // request for any other repository.
  if (repo.owner?.type === "Organization") {
    repositoryScopes.push({
      scope: "organization",
      names: listScope(
        {
          secret: `${actions}/organization-secrets`,
          variable: `${actions}/organization-variables`,
        },
        (entries) => `organization ${entries}`,
      ),
    });
  }

  const checks = environments.map(({ environment, targets, requirements }): EnvironmentCheck => {
    if (environment === null) {
      return {
        environment,
        targets,
        exists: true,
        requirements: requirements.map((requirement) =>
          checkRequirement(requirement, repositoryScopes),
        ),
      };
    }
    const base = `repos/${path}/environments/${encodeURIComponent(environment)}`;
    const result = ghApi([base]);
    if (result.status !== 0 && httpStatus(result) !== 404) {
      throw new Error(
        `Could not read environment "${environment}" of ${fullName}: ${ghMessage(result)}`,
      );
    }
    const exists = result.status === 0;
    const names: Names = exists
      ? listScope(
          { secret: `${base}/secrets`, variable: `${base}/variables` },
          (entries) => `${entries} of environment "${environment}"`,
        )
      : { secret: new Set(), variable: new Set() };
    const scopes = [{ scope: "environment" as const, names }, ...repositoryScopes];
    return {
      environment,
      targets,
      exists,
      requirements: requirements.map((requirement) => checkRequirement(requirement, scopes)),
    };
  });
  report(checks, fullName, target);
}

function resolveRepository(gh: (args: string[]) => GhOutput): Repository {
  const result = gh(REPO_VIEW_ARGS);
  const repository = result.status === 0 ? parseRepoView(result.stdout) : null;
  if (!repository) {
    const reason =
      result.status === 0
        ? `gh named a repository that cannot be embedded in commands (${result.stdout.trim()})`
        : ghMessage(result);
    throw new Error(
      `Could not tell which GitHub repository to check from the current directory: ${reason}. ` +
        "Run the check in a clone of the repository whose remote points at GitHub.",
    );
  }
  return repository;
}

function httpStatus(result: GhOutput): number | null {
  const match = /HTTP (\d{3})/.exec(result.stderr);
  return match ? Number(match[1]) : null;
}

function ghMessage(result: GhOutput): string {
  const line = result.stderr.split("\n").find((text) => text.trim() !== "") ?? "";
  return line.replace(/^gh: /, "").trim() || `gh exited with status ${String(result.status)}`;
}

function report(checks: EnvironmentCheck[], fullName: string, repository: Repository): void {
  const missing = checks
    .flatMap(({ requirements }) => requirements)
    .filter((check) => check.required && !check.registered).length;
  const summary =
    missing === 1
      ? "1 required secret or variable is missing."
      : `${String(missing)} required secrets or variables are missing.`;
  if (logger.jsonMode) {
    logger.out({ repository: fullName, environments: checks });
    if (missing > 0) throw new Error(summary);
    return;
  }
  printReport(checks, fullName, repository);
  if (missing > 0) throw new Error(`${summary} Set them with the gh commands printed above.`);
  logger.success("All required secrets and variables are registered.");
}

function printReport(checks: EnvironmentCheck[], fullName: string, repository: Repository): void {
  logger.info(`Checking the GitHub Environment secrets and variables of ${fullName}`);
  for (const group of checks) {
    const { exists, requirements } = group;
    const heading = describeGroup(group);
    logger.info(exists ? heading : `${heading} does not exist in ${fullName}`);
    for (const check of requirements) {
      logger.log(`  ${statusLine(check)}`);
    }
  }
  const unset = checks
    .map((check) => ({
      ...check,
      requirements: check.requirements.filter((r) => r.foundIn === null),
    }))
    .filter((check) => check.requirements.length > 0);
  if (unset.length > 0) logger.out(renderGhCommands(unset, repository));
}

function statusLine(check: RequirementCheck): string {
  const scope =
    check.foundIn === null || check.foundIn === "environment"
      ? ""
      : `, set on the ${check.foundIn}`;
  const label = `${check.name} (${check.type}${scope})`;
  if (check.registered && check.foundIn === null) {
    return `⚠ ${label}: set as a secret, a deprecated fallback; set it as a variable and delete the secret`;
  }
  if (check.registered) return `✔ ${label}`;
  const status = check.required ? `✖ ${label}: missing` : `- ${label}: optional, not set`;
  if (check.otherTypeIn === null) return status;
  const other = OTHER_TYPE[check.type];
  return `${status}; a ${other} of this name is set on the ${check.otherTypeIn}, but the workflow reads a ${check.type}`;
}
