import { logger } from "@tailor-platform/sdk/cli";
import { validateEnvironment, validateWorkspaceName } from "./generate";
import { detectRepository, type GitRunner, type Repository } from "./git";
import { type LockFile, readLock, type TargetKind } from "./lock";

export type EnvRequirement = {
  name: string;
  type: "secret" | "variable";
  required: boolean;
  /** What the value is. */
  description: string;
  /** Where the value comes from. */
  howTo: string;
};

export type EnvironmentRequirements = {
  environment: string;
  /** Lock targets using this environment, as `<kind> <workspaceName>`. */
  targets: string[];
  requirements: EnvRequirement[];
};

const MACHINE_USER_HOW_TO =
  "have an organization or folder admin create a platform machine user in the Tailor Console " +
  "and grant it a role (without the admin role you cannot view or create machine users)";

const CONCEPTS_NOTE =
  "Organizations, folders, and machine users: https://docs.tailor.tech/administration/account-management";

const CLIENT_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID",
  type: "secret",
  required: true,
  description:
    "Client ID of the platform machine user that CI signs in as for plan and deploy; it needs " +
    "an editor or admin role on the organization or folder that holds the workspace",
  howTo: `${MACHINE_USER_HOW_TO}; use its client ID`,
};
const CLIENT_SECRET: EnvRequirement = {
  name: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET",
  type: "secret",
  required: true,
  description: "Client secret of the same platform machine user",
  howTo: `${MACHINE_USER_HOW_TO}; use its client secret`,
};
const WORKSPACE_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_WORKSPACE_ID",
  type: "variable",
  required: true,
  description: "ID of the workspace this environment deploys to",
  howTo: "the id printed by `tailor workspace create`, or listed by `tailor workspace list`",
};
const ORGANIZATION_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_ORGANIZATION_ID",
  type: "variable",
  required: true,
  description:
    "Organization to create the per-PR preview workspaces in; a machine user cannot create " +
    "a workspace without one",
  howTo: "the organizationId listed by `tailor organization list`",
};
const FOLDER_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_FOLDER_ID",
  type: "variable",
  required: false,
  description:
    "Folder to create the per-PR preview workspaces in; when unset they are created directly " +
    "under the organization, which needs the machine user's role on the organization itself",
  howTo: "the id listed by `tailor organization folder list -o <organization id>`",
};
const FAIL_ON_DRIFT: EnvRequirement = {
  name: "TAILOR_PLATFORM_FAIL_ON_DRIFT",
  type: "variable",
  required: false,
  description: "Whether the drift check fails the job when it finds drift",
  howTo: 'set to "true" to fail; anything else only reports the drift',
};
const SLACK_BOT_TOKEN: EnvRequirement = {
  name: "TAILOR_SLACK_BOT_TOKEN",
  type: "secret",
  required: false,
  description: "Slack bot token that posts deploy notifications (set with TAILOR_SLACK_CHANNEL_ID)",
  howTo: "the Bot User OAuth Token (xoxb-...) of a Slack app with the chat:write scope",
};
const SLACK_CHANNEL_ID: EnvRequirement = {
  name: "TAILOR_SLACK_CHANNEL_ID",
  type: "variable",
  required: false,
  description: "Slack channel to post deploy notifications to (set with TAILOR_SLACK_BOT_TOKEN)",
  howTo: "the channel ID (C...) shown in the channel details in Slack; invite the bot to it",
};

const SLACK_USER_MAPPING: EnvRequirement = {
  name: "TAILOR_SLACK_USER_MAPPING",
  type: "variable",
  required: false,
  description:
    "Map from GitHub usernames to Slack user IDs so deploy notifications mention the actor; " +
    "read only after you uncomment the user-mapping input of the tailor-notify step",
  howTo:
    'a JSON object such as {"alice":"U0123456"}, with the member ID (U...) from each Slack profile',
};

const DEPLOY_REQUIREMENTS = [
  CLIENT_ID,
  CLIENT_SECRET,
  WORKSPACE_ID,
  FAIL_ON_DRIFT,
  SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID,
];

const REQUIREMENTS: Record<Exclude<TargetKind, "action">, EnvRequirement[]> = {
  branch: [...DEPLOY_REQUIREMENTS, SLACK_USER_MAPPING],
  tag: [...DEPLOY_REQUIREMENTS, SLACK_USER_MAPPING],
  coordinate: DEPLOY_REQUIREMENTS,
  preview: [CLIENT_ID, CLIENT_SECRET, ORGANIZATION_ID, FOLDER_ID, FAIL_ON_DRIFT],
};

/**
 * Secrets and variables a generated workflow of the given kind reads from its GitHub Environment.
 * @param kind - Target kind
 * @returns Requirements in display order
 */
export function targetRequirements(kind: Exclude<TargetKind, "action">): EnvRequirement[] {
  return REQUIREMENTS[kind];
}

/**
 * Group the secrets and variables every lock target needs by GitHub Environment.
 * @param lock - Lock file
 * @returns One entry per environment, in lock order
 */
export function collectEnvironmentRequirements(lock: LockFile): EnvironmentRequirements[] {
  const byEnvironment = new Map<string, EnvironmentRequirements>();
  for (const target of lock.targets) {
    if (target.kind === "action") continue;
    const { environment } = target.inputs;
    validateEnvironment(environment);
    validateWorkspaceName(target.workspaceName);
    const key = environment.toLowerCase();
    let entry = byEnvironment.get(key);
    if (!entry) {
      entry = { environment, targets: [], requirements: [] };
      byEnvironment.set(key, entry);
    }
    entry.targets.push(`${target.kind} ${target.workspaceName}`);
    for (const requirement of targetRequirements(target.kind)) {
      const existing = entry.requirements.findIndex((r) => r.name === requirement.name);
      if (existing === -1) {
        entry.requirements.push(requirement);
      } else if (requirement.required) {
        entry.requirements[existing] = requirement;
      }
    }
  }
  for (const entry of byEnvironment.values()) {
    entry.requirements.sort((a, b) => Number(b.required) - Number(a.required));
  }
  return [...byEnvironment.values()];
}

/**
 * Render `gh` commands that create each missing environment and set its secrets and variables.
 * @param environments - Requirements grouped by environment
 * @param repository - Target repository; when null, gh resolves it from the current directory
 * @returns Shell script text
 */
export function renderGhCommands(
  environments: EnvironmentRequirements[],
  repository: Repository | null = null,
): string {
  const repoPath = repository ? `${repository.owner}/${repository.name}` : "{owner}/{repo}";
  const repoFlag = repository ? ` --repo=${repository.owner}/${repository.name}` : "";
  const blocks = environments.map(({ environment, targets, requirements }) => {
    const endpoint = `"repos/${repoPath}/environments/${encodeURIComponent(environment)}"`;
    const lines = [
      `# Environment "${environment}" (${targets.join(", ")})`,
      // PUT also rewrites an existing environment and needs admin access, so only create a missing
      // one. The status is compared as text so the expected 404 exit does not fail under pipefail.
      `if [ "$(gh api -i ${endpoint} 2>/dev/null | head -n 1 | cut -d " " -f 2)" = 404 ]; then gh api -X PUT ${endpoint} --silent; fi`,
    ];
    for (const { required, type, name, description, howTo } of requirements) {
      const command = `gh ${type} set ${name} --env=${environment}${repoFlag}`;
      lines.push(
        required ? `# ${description}` : `# Optional: ${description}`,
        `#   How to get: ${howTo}`,
        required ? command : `# ${command}`,
      );
    }
    return lines.join("\n");
  });
  const header = [
    "# Run these one at a time: each `gh ... set` prompts for its value.",
    `# ${CONCEPTS_NOTE}`,
  ].join("\n");
  return `${[header, ...blocks].join("\n\n")}\n`;
}

function terraformLabel(value: string): string {
  // Hyphens are valid in HCL but not in the shell names of TF_VAR_ environment variables.
  const label = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(label) ? label : `_${label}`;
}

function assertUniqueLabels(environments: EnvironmentRequirements[]): void {
  const seen = new Map<string, string>();
  for (const { environment } of environments) {
    const label = terraformLabel(environment);
    const other = seen.get(label);
    if (other !== undefined) {
      throw new Error(
        `Environments "${other}" and "${environment}" map to the same Terraform name "${label}". ` +
          "Rename one of them to generate Terraform.",
      );
    }
    seen.set(label, environment);
  }
}

type HclAttribute = [key: string, value: string];

function hclBlock(
  header: string,
  attributes: (HclAttribute | false)[],
  nested: string[] = [],
): string {
  const present = attributes.filter((attribute) => attribute !== false);
  const width = Math.max(...present.map(([key]) => key.length));
  return [
    `${header} {`,
    ...present.map(([key, value]) => `  ${key.padEnd(width)} = ${value}`),
    ...(nested.length > 0 ? ["", ...nested.map((line) => `  ${line}`)] : []),
    "}",
  ].join("\n");
}

function requirementLabel(envLabel: string, name: string): string {
  return `${envLabel}_${name.toLowerCase()}`;
}

function terraformUsage(
  environments: EnvironmentRequirements[],
  repository: Repository | null,
): string {
  const repoName = repository?.name ?? "<repository>";
  const inputs = environments.flatMap(({ environment, requirements }) =>
    requirements.map((requirement) => ({
      ...requirement,
      environment,
      label: requirementLabel(terraformLabel(environment), requirement.name),
    })),
  );
  const optional = (required: boolean) => (required ? "" : "   # optional");
  return [
    "# Generated by `tailor setup ci env --format terraform`. It contains no values.",
    `# ${CONCEPTS_NOTE}`,
    "#",
    "# 1. Authenticate the GitHub provider, for example:",
    `#   export GITHUB_TOKEN=<token> GITHUB_OWNER=${repository?.owner ?? "<owner>"}`,
    "# 2. Set the non-secret values in terraform.tfvars:",
    ...(repository ? [] : ['#   repository = "<repository>"']),
    ...inputs
      .filter((input) => input.type === "variable")
      .map((input) => `#   ${input.label} = "<value>"${optional(input.required)}`),
    "# 3. Pass the secrets as environment variables so they stay out of files:",
    ...inputs
      .filter((input) => input.type === "secret")
      .map((input) => `#   export TF_VAR_${input.label}=<value>${optional(input.required)}`),
    "#    Note: the secret values are stored in the Terraform state in plain text. Keep the",
    "#    state encrypted and access-restricted, or set the secrets with `tailor setup ci env`",
    "#    (gh) instead and remove their resources from this file.",
    "# 4. Import each environment and variable that already exists in the repository",
    "#    (creating an existing variable fails; secrets are simply overwritten):",
    ...environments.map(
      ({ environment }) =>
        `#   terraform import github_repository_environment.${terraformLabel(environment)} ${repoName}:${environment}`,
    ),
    ...inputs
      .filter((input) => input.type === "variable")
      .map((input) => {
        const address = `github_actions_environment_variable.${input.label}`;
        const target = input.required ? address : `'${address}[0]'`;
        return `#   terraform import ${target} ${repoName}:${input.environment}:${input.name}`;
      }),
    "# 5. Apply:",
    "#   terraform init && terraform plan && terraform apply",
    "#",
    "# Optional entries are created only when their value is set. Environment protection",
    "# settings (reviewers, wait timer, branch policy) are left as configured in GitHub.",
  ].join("\n");
}

function terraformRequirement(envLabel: string, requirement: EnvRequirement): string[] {
  const { name, type, required, description, howTo } = requirement;
  const label = requirementLabel(envLabel, name);
  const input = `var.${label}`;
  const sensitive = type === "secret";
  // A sensitive value cannot drive `count` directly; only its presence is revealed.
  const supplied = sensitive ? `nonsensitive(${input} != null)` : `${input} != null`;
  const variable =
    `# How to get: ${howTo}\n` +
    hclBlock(`variable "${label}"`, [
      ["description", JSON.stringify(description)],
      ["type", "string"],
      !required && ["default", "null"],
      sensitive && ["sensitive", "true"],
    ]);
  const resource = hclBlock(`resource "github_actions_environment_${type}" "${label}"`, [
    !required && ["count", `${supplied} ? 1 : 0`],
    ["repository", "var.repository"],
    ["environment", `github_repository_environment.${envLabel}.environment`],
    [`${type}_name`, JSON.stringify(name)],
    [sensitive ? "plaintext_value" : "value", input],
  ]);
  return [variable, resource];
}

/**
 * Render Terraform (integrations/github provider) that creates each environment and sets its
 * secrets and variables from input variables.
 * @param environments - Requirements grouped by environment
 * @param repository - Target repository; when null, its name is left as an input variable
 * @returns HCL text
 */
export function renderTerraform(
  environments: EnvironmentRequirements[],
  repository: Repository | null = null,
): string {
  assertUniqueLabels(environments);
  const blocks = [
    terraformUsage(environments, repository),
    [
      "terraform {",
      "  required_providers {",
      "    github = {",
      '      source = "integrations/github"',
      "    }",
      "  }",
      "}",
    ].join("\n"),
    hclBlock('variable "repository"', [
      ["description", JSON.stringify("Repository name (without the owner)")],
      ["type", "string"],
      repository !== null && ["default", JSON.stringify(repository.name)],
    ]),
  ];
  for (const { environment, targets, requirements } of environments) {
    const envLabel = terraformLabel(environment);
    blocks.push(
      [
        `# Environment "${environment}" (${targets.join(", ")})`,
        hclBlock(
          `resource "github_repository_environment" "${envLabel}"`,
          [
            ["repository", "var.repository"],
            ["environment", JSON.stringify(environment)],
          ],
          [
            "# Remove to manage the protection settings here as well.",
            "lifecycle {",
            "  ignore_changes = [reviewers, wait_timer, deployment_branch_policy, prevent_self_review, can_admins_bypass]",
            "}",
          ],
        ),
      ].join("\n"),
      ...requirements.flatMap((requirement) => terraformRequirement(envLabel, requirement)),
    );
  }
  return `${blocks.join("\n\n")}\n`;
}

export type EnvFormat = "gh" | "terraform";

function selectEnvironments(
  environments: EnvironmentRequirements[],
  names: string[],
): EnvironmentRequirements[] {
  if (names.length === 0) return environments;
  const byName = new Map(environments.map((entry) => [entry.environment.toLowerCase(), entry]));
  const selected = names.map((name) => {
    const entry = byName.get(name.toLowerCase());
    if (!entry) {
      throw new Error(
        `No generated workflow uses the environment "${name}". ` +
          `Environments in .github/tailor.lock: ${environments.map((e) => e.environment).join(", ")}.`,
      );
    }
    return entry;
  });
  return [...new Set(selected)];
}

/**
 * Print what each GitHub Environment used by the generated workflows needs. Read-only.
 * @param options - Env options
 * @param options.outputDir - Repository root where `.github` lives
 * @param options.format - Output format
 * @param options.environments - Only print these environments; all when empty
 * @param options.gitRunner - Injectable git runner, for testing
 */
export function setupEnv(options: {
  outputDir: string;
  format: EnvFormat;
  environments?: string[];
  gitRunner?: GitRunner;
}): void {
  const lock = readLock(options.outputDir);
  if (!lock || lock.targets.length === 0) {
    throw new Error(
      "No managed workflows found (.github/tailor.lock is missing or empty). " +
        "Run `tailor setup ci branch` (or another setup subcommand) first.",
    );
  }
  const allEnvironments = collectEnvironmentRequirements(lock);
  if (allEnvironments.length === 0) {
    throw new Error(
      "Composite actions read no secrets or variables themselves. " +
        "Run `tailor setup ci coordinate` to generate the workflow that uses them, then re-run this command.",
    );
  }
  const environments = selectEnvironments(allEnvironments, options.environments ?? []);
  if (logger.jsonMode) {
    logger.out(environments);
    return;
  }
  const repository = detectRepository(options.outputDir, options.gitRunner);
  logger.out(
    options.format === "terraform"
      ? renderTerraform(environments, repository)
      : renderGhCommands(environments, repository),
  );
}
