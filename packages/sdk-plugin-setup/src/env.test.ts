import { logger } from "@tailor-platform/sdk/cli";
import { describe, expect, test, vi } from "vitest";
import {
  collectEnvironmentRequirements,
  renderGhCommands,
  renderTerraform,
  setupEnv,
  targetRequirements,
} from "./env";
import { LOCK_VERSION, type LockFile, type LockTarget, type TargetKind, writeLock } from "./lock";
import {
  renderBranchWorkflow,
  renderCoordinateWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
} from "./templates";
import { tempDir } from "./test-helpers/temp-dir";

const target = (kind: TargetKind, workspaceName: string, environment: string): LockTarget => ({
  kind,
  workspaceName,
  file: `.github/workflows/tailor-${workspaceName}.yml`,
  templateVersion: 1,
  inputs: { branch: "main", tagPattern: null, environment, dir: ".", packageManager: "pnpm" },
  generatedIds: [],
  contentHash: "sha256:abc",
});

const lockOf = (...targets: LockTarget[]): LockFile => ({ version: LOCK_VERSION, targets });

function referencedNames(content: string): string[] {
  const names = new Set<string>();
  for (const line of content.split("\n")) {
    const comment = line.trimStart().startsWith("#");
    if (comment && !line.trimStart().startsWith("# editable:")) continue;
    for (const match of line.matchAll(/\b(secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const type = match[1] === "secrets" ? "secret" : "variable";
      if (match[2] !== "GITHUB_TOKEN") names.add(`${type} ${match[2]!}`);
    }
  }
  return [...names].toSorted();
}

const namesOf = (kind: Exclude<TargetKind, "action">) =>
  targetRequirements(kind)
    .map((r) => `${r.type} ${r.name}`)
    .toSorted();

describe("targetRequirements matches the secrets/vars the rendered templates reference", () => {
  const common = {
    workspaceName: "my-app",
    environment: "my-app",
    packageManager: "pnpm" as const,
  };
  const app = { name: "ims", dir: "apps/ims" };

  test.each([
    ["branch", renderBranchWorkflow({ ...common, branch: "main", erdPreview: null })],
    [
      "branch",
      renderBranchWorkflow({
        ...common,
        branch: "main",
        erdPreview: { namespaces: ["tailordb"] },
        seedValidate: true,
        migrationDriftCheck: true,
      }),
    ],
    ["tag", renderTagWorkflow({ ...common, tagPattern: "v*" })],
    ["tag", renderTagWorkflow({ ...common, tagPattern: "v*", branch: "main" })],
    ["preview", renderPreviewWorkflow({ ...common, branch: "main", region: "us-west" })],
    [
      "coordinate",
      renderCoordinateWorkflow({
        coordinatorName: "all",
        kind: "branch",
        branch: "main",
        actionGroups: [{ id: "ims", apps: [app] }],
        environment: "all",
        packageManager: "pnpm",
      }),
    ],
    [
      "coordinate",
      renderCoordinateWorkflow({
        coordinatorName: "all",
        kind: "tag",
        actionGroups: [
          {
            id: "ims-oms",
            apps: [
              { ...app, hasStaticWebsites: true },
              { name: "oms", dir: "apps/oms" },
            ],
          },
        ],
        environment: "all",
        packageManager: "pnpm",
      }),
    ],
  ] as const)("%s", (kind, render) => {
    expect(referencedNames(render.content)).toEqual(namesOf(kind));
  });
});

describe("how to get each value", () => {
  test.each(["branch", "tag", "coordinate", "preview"] as const)(
    "is described for every entry a %s target needs",
    (kind) => {
      expect(targetRequirements(kind).filter((r) => r.howTo.trim() === "")).toEqual([]);
    },
  );

  test("points to the Console and an organization or folder admin for the machine user credentials, not to Tailor support", () => {
    const [clientId, clientSecret] = targetRequirements("branch");

    for (const requirement of [clientId, clientSecret]) {
      expect(requirement?.howTo).toContain("organization or folder admin");
      expect(requirement?.howTo).toContain("Tailor Console");
      expect(requirement?.howTo).not.toContain("support");
    }
  });

  test("says that without the admin role machine users can be neither viewed nor created", () => {
    const [clientId] = targetRequirements("branch");

    expect(clientId?.howTo).toContain("cannot view or create machine users");
  });
});

describe("collectEnvironmentRequirements", () => {
  test("lists the credentials and workspace id a branch target needs", () => {
    const [env] = collectEnvironmentRequirements(lockOf(target("branch", "my-app", "stg")));

    expect(env?.environment).toBe("stg");
    expect(env?.requirements.filter((r) => r.required).map((r) => [r.type, r.name])).toEqual([
      ["secret", "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID"],
      ["secret", "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET"],
      ["variable", "TAILOR_PLATFORM_WORKSPACE_ID"],
    ]);
  });

  test("marks Slack notification and fail-on-drift settings as optional", () => {
    const [env] = collectEnvironmentRequirements(lockOf(target("branch", "my-app", "stg")));

    expect(env?.requirements.filter((r) => !r.required).map((r) => r.name)).toEqual([
      "TAILOR_PLATFORM_FAIL_ON_DRIFT",
      "TAILOR_SLACK_BOT_TOKEN",
      "TAILOR_SLACK_CHANNEL_ID",
      "TAILOR_SLACK_USER_MAPPING",
    ]);
  });

  test("does not ask a preview target for a workspace id", () => {
    const [env] = collectEnvironmentRequirements(lockOf(target("preview", "my-app", "pr")));
    const names = env?.requirements.map((r) => r.name);

    expect(names).not.toContain("TAILOR_PLATFORM_WORKSPACE_ID");
    expect(names).toContain("TAILOR_PLATFORM_ORGANIZATION_ID");
    expect(names).toContain("TAILOR_PLATFORM_FOLDER_ID");
  });

  test("requires the preview organization, since a machine user cannot create a workspace without one", () => {
    const [env] = collectEnvironmentRequirements(lockOf(target("preview", "my-app", "pr")));
    const organization = env?.requirements.find(
      (r) => r.name === "TAILOR_PLATFORM_ORGANIZATION_ID",
    );

    expect(organization?.required).toBe(true);
  });

  test("explains when the preview folder can be omitted", () => {
    const [env] = collectEnvironmentRequirements(lockOf(target("preview", "my-app", "pr")));
    const folder = env?.requirements.find((r) => r.name === "TAILOR_PLATFORM_FOLDER_ID");

    expect(folder?.required).toBe(false);
    expect(folder?.description).toMatch(/directly under the organization/);
  });

  test("merges targets sharing an environment into one entry without duplicates", () => {
    const envs = collectEnvironmentRequirements(
      lockOf(target("branch", "my-app", "stg"), target("preview", "my-app", "stg")),
    );

    expect(envs).toHaveLength(1);
    expect(envs[0]?.targets).toEqual(["branch my-app", "preview my-app"]);
    const names = envs[0]?.requirements.map((r) => r.name) ?? [];
    expect(names).toContain("TAILOR_PLATFORM_WORKSPACE_ID");
    expect(names).toContain("TAILOR_PLATFORM_ORGANIZATION_ID");
    expect(new Set(names).size).toBe(names.length);
  });

  test("keeps separate environments in lock order", () => {
    const envs = collectEnvironmentRequirements(
      lockOf(target("tag", "my-app", "production"), target("branch", "my-app", "stg")),
    );

    expect(envs.map((e) => e.environment)).toEqual(["production", "stg"]);
  });

  test("skips composite action targets, which read no secrets or variables", () => {
    const envs = collectEnvironmentRequirements(
      lockOf(target("action", "ims", "ims"), target("coordinate", "all", "production")),
    );

    expect(envs.map((e) => e.environment)).toEqual(["production"]);
  });

  test("treats environment names differing only in case as one environment, as GitHub does", () => {
    const envs = collectEnvironmentRequirements(
      lockOf(target("branch", "my-app", "production"), target("tag", "my-app", "Production")),
    );

    expect(envs.map((e) => e.environment)).toEqual(["production"]);
  });

  test("rejects a workspace name that is unsafe to embed in the output", () => {
    expect(() =>
      collectEnvironmentRequirements(lockOf(target("branch", "my-app\ngh repo delete", "stg"))),
    ).toThrow(/workspace name/i);
  });

  test("rejects an environment name that is unsafe to embed in commands", () => {
    expect(() =>
      collectEnvironmentRequirements(lockOf(target("branch", "my-app", "stg; rm -rf /"))),
    ).toThrow(/Invalid environment name/);
  });
});

describe("renderGhCommands", () => {
  const envs = () => collectEnvironmentRequirements(lockOf(target("branch", "my-app", "stg/eu")));

  test("creates the environment, only when GitHub reports it missing, before setting its secrets and variables", () => {
    const lines = renderGhCommands(envs()).split("\n");

    const create = lines.indexOf(
      'if [ "$(gh api -i "repos/{owner}/{repo}/environments/stg%2Feu" 2>/dev/null | head -n 1 | cut -d " " -f 2)" = 404 ]; then ' +
        'gh api -X PUT "repos/{owner}/{repo}/environments/stg%2Feu" --silent; fi',
    );
    const firstSecret = lines.findIndex((l) => l.startsWith("gh secret set"));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(create).toBeLessThan(firstSecret);
  });

  test("sets required entries without embedding any value", () => {
    const lines = renderGhCommands(envs()).split("\n");

    expect(lines).toContain("gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env=stg/eu");
    expect(lines).toContain(
      "gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env=stg/eu",
    );
    expect(lines).toContain("gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env=stg/eu");
    expect(lines.some((l) => l.includes("--body"))).toBe(false);
  });

  test("leaves optional entries commented out so pasting the output skips them", () => {
    const lines = renderGhCommands(envs()).split("\n");

    expect(lines).toContain("# gh secret set TAILOR_SLACK_BOT_TOKEN --env=stg/eu");
    expect(lines).not.toContain("gh secret set TAILOR_SLACK_BOT_TOKEN --env=stg/eu");
  });

  test("explains how to get the value right under each description", () => {
    const lines = renderGhCommands(envs()).split("\n");
    const setter = lines.indexOf("gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env=stg/eu");

    expect(lines[setter - 1]).toMatch(/^# {3}How to get: .*tailor workspace create/);
  });

  test("links to the Tailor Platform docs that explain organizations, folders, and machine users", () => {
    expect(renderGhCommands(envs())).toContain(
      "https://docs.tailor.tech/administration/account-management",
    );
  });

  test("tells the user to run the commands one at a time, since gh prompts for each value", () => {
    expect(renderGhCommands(envs()).split("\n")[0]).toMatch(/^# .*one at a time/);
  });

  test("keeps every non-command line a shell comment", () => {
    const lines = renderGhCommands(envs()).split("\n");

    const isCommand = (l: string) => l.startsWith("gh ") || l.startsWith('if [ "$(gh ');
    expect(lines.filter((l) => l !== "" && !l.startsWith("#") && !isCommand(l))).toEqual([]);
  });
});

describe("when the repository is known from the origin remote", () => {
  const repository = { owner: "tailor-platform", name: "sdk" };
  const envs = () => collectEnvironmentRequirements(lockOf(target("tag", "my-app", "production")));

  test("gh commands target that repository instead of the current directory", () => {
    const lines = renderGhCommands(envs(), repository).split("\n");

    expect(lines).toContain(
      'if [ "$(gh api -i "repos/tailor-platform/sdk/environments/production" 2>/dev/null | head -n 1 | cut -d " " -f 2)" = 404 ]; then ' +
        'gh api -X PUT "repos/tailor-platform/sdk/environments/production" --silent; fi',
    );
    expect(lines).toContain(
      "gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env=production --repo=tailor-platform/sdk",
    );
  });

  test("Terraform defaults the repository variable to its name", () => {
    expect(renderTerraform(envs(), repository)).toContain(
      [
        'variable "repository" {',
        '  description = "Repository name (without the owner)"',
        "  type        = string",
        '  default     = "sdk"',
        "}",
      ].join("\n"),
    );
  });

  test("Terraform instructions use the actual owner and repository name", () => {
    const hcl = renderTerraform(envs(), repository);

    expect(hcl).toContain("#   export GITHUB_TOKEN=<token> GITHUB_OWNER=tailor-platform");
    expect(hcl).toContain(
      "#   terraform import github_repository_environment.production sdk:production",
    );
    expect(hcl).not.toContain('#   repository = "<repository>"');
  });
});

describe("renderTerraform", () => {
  const envs = () =>
    collectEnvironmentRequirements(
      lockOf(target("branch", "my-app", "stg/eu"), target("tag", "my-app", "production")),
    );

  test("declares one github_repository_environment per environment", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain('resource "github_repository_environment" "stg_eu" {');
    expect(hcl).toContain('  environment = "stg/eu"');
    expect(hcl).toContain('resource "github_repository_environment" "production" {');
  });

  test("explains how to get each value above its input variable", () => {
    expect(renderTerraform(envs())).toMatch(
      /# How to get: .*tailor workspace create.*\nvariable "production_tailor_platform_workspace_id" \{/,
    );
  });

  test("takes secret values from sensitive variables instead of embedding them", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain(
      [
        'variable "stg_eu_tailor_platform_machine_user_client_secret" {',
        '  description = "Client secret of the same platform machine user"',
        "  type        = string",
        "  sensitive   = true",
        "}",
      ].join("\n"),
    );
    expect(hcl).toContain(
      [
        'resource "github_actions_environment_secret" "stg_eu_tailor_platform_machine_user_client_secret" {',
        "  repository      = var.repository",
        "  environment     = github_repository_environment.stg_eu.environment",
        '  secret_name     = "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET"',
        "  plaintext_value = var.stg_eu_tailor_platform_machine_user_client_secret",
        "}",
      ].join("\n"),
    );
  });

  test("sets variables from non-sensitive input variables", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain(
      [
        'resource "github_actions_environment_variable" "production_tailor_platform_workspace_id" {',
        "  repository    = var.repository",
        "  environment   = github_repository_environment.production.environment",
        '  variable_name = "TAILOR_PLATFORM_WORKSPACE_ID"',
        "  value         = var.production_tailor_platform_workspace_id",
        "}",
      ].join("\n"),
    );
  });

  test("creates optional entries only when their variable is supplied", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toMatch(
      /variable "production_tailor_slack_bot_token" \{[^}]*default {5}= null\n {2}sensitive {3}= true\n\}/,
    );
    expect(hcl).toMatch(
      /"production_tailor_slack_bot_token" \{\n {2}count {11}= nonsensitive\(var\.production_tailor_slack_bot_token != null\) \? 1 : 0\n/,
    );
    expect(hcl).toMatch(
      /"production_tailor_slack_channel_id" \{\n {2}count {9}= var\.production_tailor_slack_channel_id != null \? 1 : 0\n/,
    );
  });

  test("uses underscores in Terraform names so secrets can be passed as TF_VAR_ environment variables", () => {
    const hcl = renderTerraform(
      collectEnvironmentRequirements(lockOf(target("branch", "my-app", "my-app-stg"))),
    );

    expect(hcl).toContain('resource "github_repository_environment" "my_app_stg" {');
    expect(hcl).toContain('variable "my_app_stg_tailor_platform_machine_user_client_id" {');
  });

  test("leaves the protection settings of an imported environment untouched", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain(
      "    ignore_changes = [reviewers, wait_timer, deployment_branch_policy, prevent_self_review, can_admins_bypass]",
    );
  });

  test("explains how to pass each secret without writing it to a file", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain(
      "#   export TF_VAR_production_tailor_platform_machine_user_client_secret=",
    );
    expect(hcl).toContain("#   export TF_VAR_stg_eu_tailor_platform_machine_user_client_id=");
  });

  test("links to the Tailor Platform docs that explain organizations, folders, and machine users", () => {
    expect(renderTerraform(envs())).toContain(
      "https://docs.tailor.tech/administration/account-management",
    );
  });

  test("warns that secret values end up in the Terraform state", () => {
    expect(renderTerraform(envs())).toMatch(
      /^# .*secret values are stored in the Terraform state/im,
    );
  });

  test("explains how to import each environment that already exists", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain(
      "#   terraform import github_repository_environment.production <repository>:production",
    );
    expect(hcl).toContain(
      "#   terraform import github_repository_environment.stg_eu <repository>:stg/eu",
    );
  });

  test("explains how to import each variable that already exists, since creating one fails", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain(
      "#   terraform import github_actions_environment_variable.production_tailor_platform_workspace_id <repository>:production:TAILOR_PLATFORM_WORKSPACE_ID",
    );
  });

  test("addresses optional variables by their count index when importing", () => {
    const hcl = renderTerraform(envs());

    expect(hcl).toContain(
      "#   terraform import 'github_actions_environment_variable.production_tailor_slack_channel_id[0]' <repository>:production:TAILOR_SLACK_CHANNEL_ID",
    );
  });

  test("rejects environments whose Terraform names would collide", () => {
    const colliding = collectEnvironmentRequirements(
      lockOf(target("branch", "app-eu", "stg/eu"), target("tag", "app-eu", "stg.eu")),
    );

    expect(() => renderTerraform(colliding)).toThrow(/stg\/eu.*stg\.eu|stg\.eu.*stg\/eu/);
  });
});

describe("setupEnv", () => {
  test("fails when no lock exists", () => {
    using tmp = tempDir("setup-env-");

    expect(() => setupEnv({ outputDir: tmp.dir, format: "gh" })).toThrow(/tailor\.lock/);
  });

  test("points to `setup ci coordinate` when the lock only has composite actions", () => {
    using tmp = tempDir("setup-env-");
    writeLock(tmp.dir, lockOf(target("action", "ims", "ims")));

    expect(() => setupEnv({ outputDir: tmp.dir, format: "gh" })).toThrow(/setup ci coordinate/);
  });

  test.each([
    ["gh", renderGhCommands],
    ["terraform", renderTerraform],
  ] as const)("prints the %s output to stdout", (format, render) => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format });

    expect(out).toHaveBeenCalledWith(render(collectEnvironmentRequirements(lock)));
  });

  test("fills in the repository detected from the origin remote", () => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({
      outputDir: tmp.dir,
      format: "gh",
      gitRunner: () => "git@github.com:tailor-platform/sdk.git",
    });

    expect(out).toHaveBeenCalledWith(
      renderGhCommands(collectEnvironmentRequirements(lock), {
        owner: "tailor-platform",
        name: "sdk",
      }),
    );
  });

  test("prints only the environments passed with --environment, ignoring case", () => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"), target("tag", "my-app", "production"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format: "gh", environments: ["Production"] });

    const [, production] = collectEnvironmentRequirements(lock);
    expect(out).toHaveBeenCalledWith(renderGhCommands([production!]));
  });

  test("prints an environment once even when --environment names it twice", () => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"), target("tag", "my-app", "production"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format: "gh", environments: ["stg", "STG"] });

    const [stg] = collectEnvironmentRequirements(lock);
    expect(out).toHaveBeenCalledWith(renderGhCommands([stg!]));
  });

  test("rejects an --environment that no workflow uses, listing the ones that exist", () => {
    using tmp = tempDir("setup-env-");
    writeLock(
      tmp.dir,
      lockOf(target("branch", "my-app", "stg"), target("tag", "my-app", "production")),
    );

    expect(() => setupEnv({ outputDir: tmp.dir, format: "gh", environments: ["prod"] })).toThrow(
      /"prod".*stg, production/,
    );
  });

  test("prints the grouped requirements as data in JSON mode", () => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});
    using _json = vi.spyOn(logger, "jsonMode", "get").mockReturnValue(true);

    setupEnv({ outputDir: tmp.dir, format: "gh" });

    expect(out).toHaveBeenCalledWith(collectEnvironmentRequirements(lock));
  });
});
