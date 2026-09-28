import { logBetaWarning, logger } from "@tailor-platform/sdk/cli";
import { validateEnvironment } from "./generate";
import { type LockFile, readLock, type TargetKind } from "./lock";

export type EnvRequirement = {
  name: string;
  type: "secret" | "variable";
  required: boolean;
  description: string;
};

export type EnvironmentRequirements = {
  environment: string;
  /** Lock targets using this environment, as `<kind> <workspaceName>`. */
  targets: string[];
  requirements: EnvRequirement[];
};

const CLIENT_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID",
  type: "secret",
  required: true,
  description: "Machine user client ID",
};
const CLIENT_SECRET: EnvRequirement = {
  name: "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET",
  type: "secret",
  required: true,
  description: "Machine user client secret",
};
const WORKSPACE_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_WORKSPACE_ID",
  type: "variable",
  required: true,
  description: "ID of the workspace to deploy to (tailor workspace create)",
};
const ORGANIZATION_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_ORGANIZATION_ID",
  type: "variable",
  required: false,
  description: "Organization ID to create per-PR preview workspaces in",
};
const FOLDER_ID: EnvRequirement = {
  name: "TAILOR_PLATFORM_FOLDER_ID",
  type: "variable",
  required: false,
  description: "Folder ID to create per-PR preview workspaces in",
};
const FAIL_ON_DRIFT: EnvRequirement = {
  name: "TAILOR_PLATFORM_FAIL_ON_DRIFT",
  type: "variable",
  required: false,
  description: 'Set to "true" to fail the drift check when drift is found',
};
const SLACK_BOT_TOKEN: EnvRequirement = {
  name: "TAILOR_SLACK_BOT_TOKEN",
  type: "secret",
  required: false,
  description: "Slack bot token for deploy notifications (set with TAILOR_SLACK_CHANNEL_ID)",
};
const SLACK_CHANNEL_ID: EnvRequirement = {
  name: "TAILOR_SLACK_CHANNEL_ID",
  type: "variable",
  required: false,
  description: "Slack channel ID for deploy notifications (set with TAILOR_SLACK_BOT_TOKEN)",
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
  branch: DEPLOY_REQUIREMENTS,
  tag: DEPLOY_REQUIREMENTS,
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
    let entry = byEnvironment.get(environment);
    if (!entry) {
      entry = { environment, targets: [], requirements: [] };
      byEnvironment.set(environment, entry);
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
 * Render `gh` commands that create each environment and set its secrets and variables.
 * @param environments - Requirements grouped by environment
 * @returns Shell script text
 */
export function renderGhCommands(environments: EnvironmentRequirements[]): string {
  const blocks = environments.map(({ environment, targets, requirements }) => {
    const lines = [
      `# Environment "${environment}" (${targets.join(", ")})`,
      `gh api -X PUT "repos/{owner}/{repo}/environments/${encodeURIComponent(environment)}"`,
    ];
    for (const { required, type, name, description } of requirements) {
      const command = `gh ${type} set ${name} --env ${environment}`;
      lines.push(
        required ? `# ${description}` : `# Optional: ${description}`,
        required ? command : `# ${command}`,
      );
    }
    return lines.join("\n");
  });
  const header = "# Run these one at a time: each `gh ... set` prompts for its value.";
  return `${[header, ...blocks].join("\n\n")}\n`;
}

function terraformLabel(value: string): string {
  const label = value.replace(/[^A-Za-z0-9_-]/g, "_");
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

function hclBlock(header: string, attributes: (HclAttribute | false)[]): string {
  const present = attributes.filter((attribute) => attribute !== false);
  const width = Math.max(...present.map(([key]) => key.length));
  return [
    `${header} {`,
    ...present.map(([key, value]) => `  ${key.padEnd(width)} = ${value}`),
    "}",
  ].join("\n");
}

function terraformRequirement(envLabel: string, requirement: EnvRequirement): string[] {
  const { name, type, required, description } = requirement;
  const label = `${envLabel}_${name.toLowerCase()}`;
  const input = `var.${label}`;
  const sensitive = type === "secret";
  // A sensitive value cannot drive `count` directly; only its presence is revealed.
  const supplied = sensitive ? `nonsensitive(${input} != null)` : `${input} != null`;
  const variable = hclBlock(`variable "${label}"`, [
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
 * @returns HCL text
 */
export function renderTerraform(environments: EnvironmentRequirements[]): string {
  assertUniqueLabels(environments);
  const blocks = [
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
    ]),
  ];
  for (const { environment, targets, requirements } of environments) {
    const envLabel = terraformLabel(environment);
    blocks.push(
      [
        `# Environment "${environment}" (${targets.join(", ")})`,
        hclBlock(`resource "github_repository_environment" "${envLabel}"`, [
          ["repository", "var.repository"],
          ["environment", JSON.stringify(environment)],
        ]),
      ].join("\n"),
      ...requirements.flatMap((requirement) => terraformRequirement(envLabel, requirement)),
    );
  }
  return `${blocks.join("\n\n")}\n`;
}

export type EnvFormat = "gh" | "terraform";

/**
 * Print what each GitHub Environment used by the generated workflows needs. Read-only.
 * @param options - Env options
 * @param options.outputDir - Repository root where `.github` lives
 * @param options.format - Output format
 */
export function setupEnv(options: { outputDir: string; format: EnvFormat }): void {
  logBetaWarning("setup");

  const lock = readLock(options.outputDir);
  if (!lock || lock.targets.length === 0) {
    throw new Error(
      "No managed workflows found (.github/tailor.lock is missing or empty). " +
        "Run `tailor setup ci branch` (or another setup subcommand) first.",
    );
  }
  const environments = collectEnvironmentRequirements(lock);
  if (environments.length === 0) {
    throw new Error(
      "Composite actions read no secrets or variables themselves. " +
        "Run `tailor setup ci coordinate` to generate the workflow that uses them, then re-run this command.",
    );
  }
  if (logger.jsonMode) {
    logger.out(environments);
    return;
  }
  logger.out(
    options.format === "terraform" ? renderTerraform(environments) : renderGhCommands(environments),
  );
}
