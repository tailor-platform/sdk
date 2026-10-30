import { logger } from "@tailor-platform/sdk/cli";
import { describe, expect, test, vi } from "vitest";
import {
  autofixRequirements,
  collectEnvironmentRequirements,
  renderGhCommands,
  renderTerraform,
  SECRET_FALLBACK_VARIABLES,
  setupEnv,
  targetRequirements,
} from "./env";
import { LOCK_VERSION, type LockFile, type LockTarget, type TargetKind, writeLock } from "./lock";
import {
  AUTOFIX_PROVIDERS,
  renderBranchWorkflow,
  renderPreviewWorkflow,
  renderTagWorkflow,
  type AutofixProvider,
} from "./templates";
import { autofixLockEntry, renderAutofixFor } from "./test-helpers/autofix";
import { envTarget as target } from "./test-helpers/env-target";
import { tempDir } from "./test-helpers/temp-dir";
import type { GhRunner } from "./gh";

const lockOf = (...targets: LockTarget[]): LockFile => ({ version: LOCK_VERSION, targets });

function referencedNames(content: string): string[] {
  const names = new Set<string>();
  for (const line of content.split("\n")) {
    const comment = line.trimStart().startsWith("#");
    if (comment && !line.trimStart().startsWith("# editable:")) continue;
    for (const match of line.matchAll(/\b(secrets|vars)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      const type = match[1] === "secrets" ? "secret" : "variable";
      if (type === "secret" && line.includes(`vars.${match[2]!} ||`)) continue;
      if (match[2] !== "GITHUB_TOKEN") names.add(`${type} ${match[2]!}`);
    }
  }
  return [...names].toSorted();
}

const namesOf = (kind: TargetKind) =>
  targetRequirements(kind)
    .map((r) => `${r.type} ${r.name}`)
    .toSorted();

function fallbackSecretNames(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(/\bvars\.([A-Za-z_][A-Za-z0-9_]*) \|\| secrets\.\1\b/g)) {
    names.add(match[1]!);
  }
  return [...names].toSorted();
}

describe("targetRequirements matches the secrets/vars the rendered templates reference", () => {
  const common = {
    workspaceName: "my-app",
    environment: "my-app",
    packageManager: "pnpm" as const,
  };
  const renders = [
    [
      "branch",
      renderBranchWorkflow({ ...common, branch: "main", erdPreview: null, seed: { datasets: [] } }),
    ],
    [
      "branch",
      renderBranchWorkflow({
        ...common,
        branch: "main",
        erdPreview: { namespaces: ["tailordb"] },
        seedValidate: true,
        migrationDriftCheck: true,
        seed: { datasets: [] },
      }),
    ],
    ["tag", renderTagWorkflow({ ...common, tagPattern: "v*", seed: { datasets: [] } })],
    [
      "tag",
      renderTagWorkflow({ ...common, tagPattern: "v*", branch: "main", seed: { datasets: [] } }),
    ],
    [
      "preview",
      renderPreviewWorkflow({
        ...common,
        branch: "main",
        region: "us-west",
        seed: { datasets: [] },
      }),
    ],
  ] as const;

  test.each(renders)("%s", (kind, render) => {
    expect(referencedNames(render.content)).toEqual(namesOf(kind));
  });

  test.each(renders)(
    "%s falls back to a same-name secret only for the listed variables",
    (_, render) => {
      expect(fallbackSecretNames(render.content)).toEqual(
        [...SECRET_FALLBACK_VARIABLES].toSorted(),
      );
    },
  );
});

const withAutofix = (provider: AutofixProvider, ...targets: LockTarget[]): LockFile => ({
  ...lockOf(...targets),
  autofix: autofixLockEntry(provider),
});

describe("autofixRequirements matches the secrets/vars the rendered autofix workflow references", () => {
  test.each(AUTOFIX_PROVIDERS)("%s", (provider) => {
    expect(referencedNames(renderAutofixFor(provider).content)).toEqual(
      autofixRequirements(provider)
        .map((r) => `${r.type} ${r.name}`)
        .toSorted(),
    );
  });
});

describe("repository secrets and variables of the autofix workflow", () => {
  const repository = { owner: "acme", name: "app" };

  test("form a group of their own after the environments", () => {
    const groups = collectEnvironmentRequirements(
      withAutofix("github-app", target("branch", "my-app", "stg")),
    );

    expect(groups.map((group) => [group.environment, group.targets])).toEqual([
      ["stg", ["branch my-app"]],
      [null, ["autofix"]],
    ]);
    expect(groups[1]?.requirements.map((r) => [r.type, r.name, r.required])).toEqual([
      ["variable", "TAILOR_AUTOFIX_APP_CLIENT_ID", true],
      ["secret", "TAILOR_AUTOFIX_APP_PRIVATE_KEY", true],
    ]);
  });

  test.each(["github-token", "autofix-ci"] as const)(
    "are not listed for %s, which reads none",
    (provider) => {
      expect(
        collectEnvironmentRequirements(
          withAutofix(provider, target("branch", "my-app", "stg")),
        ).map((group) => group.environment),
      ).toEqual(["stg"]);
    },
  );

  test("describe the securefix client App for securefix", () => {
    const [group] = collectEnvironmentRequirements(withAutofix("securefix"));

    expect(group?.requirements.map((r) => r.name)).toEqual([
      "TAILOR_AUTOFIX_APP_CLIENT_ID",
      "TAILOR_AUTOFIX_APP_PRIVATE_KEY",
    ]);
    expect(group?.requirements[0]?.description).toMatch(/securefix client/);
  });

  test("are set on the repository by the gh commands, with no environment", () => {
    const lines = renderGhCommands(
      collectEnvironmentRequirements(withAutofix("github-app")),
      repository,
    ).split("\n");

    expect(lines).toContain("# Repository secrets and variables (autofix)");
    expect(lines).toContain("gh variable set TAILOR_AUTOFIX_APP_CLIENT_ID --repo=acme/app");
    expect(lines).toContain("gh secret set TAILOR_AUTOFIX_APP_PRIVATE_KEY --repo=acme/app");
    expect(lines.some((line) => line.includes("environments/"))).toBe(false);
  });

  test("are repository secrets and variables in Terraform", () => {
    const hcl = renderTerraform(collectEnvironmentRequirements(withAutofix("github-app")));

    expect(hcl).toContain(
      [
        'resource "github_actions_variable" "repository_tailor_autofix_app_client_id" {',
        "  repository    = var.repository",
        '  variable_name = "TAILOR_AUTOFIX_APP_CLIENT_ID"',
        "  value         = var.repository_tailor_autofix_app_client_id",
        "}",
      ].join("\n"),
    );
    expect(hcl).toContain(
      [
        'resource "github_actions_secret" "repository_tailor_autofix_app_private_key" {',
        "  repository      = var.repository",
        '  secret_name     = "TAILOR_AUTOFIX_APP_PRIVATE_KEY"',
        "  plaintext_value = var.repository_tailor_autofix_app_private_key",
        "}",
      ].join("\n"),
    );
    expect(hcl).toContain(
      "#   terraform import github_actions_variable.repository_tailor_autofix_app_client_id <repository>:TAILOR_AUTOFIX_APP_CLIENT_ID",
    );
    expect(hcl).not.toContain("github_repository_environment");
  });

  test("keep their Terraform names apart from an environment named repository", () => {
    expect(() =>
      renderTerraform(
        collectEnvironmentRequirements(
          withAutofix("github-app", target("branch", "my-app", "repository")),
        ),
      ),
    ).toThrow(/"repository"/);
  });

  test("are printed for a lock that records only the autofix workflow", () => {
    using tmp = tempDir("setup-env-");
    const lock = withAutofix("github-app");
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format: "gh", gitRunner: () => "git@github.com:acme/app.git" });

    expect(out).toHaveBeenCalledWith(
      renderGhCommands(collectEnvironmentRequirements(lock), repository),
    );
  });

  test("leave --environment nothing to select when no target uses an environment", () => {
    using tmp = tempDir("setup-env-");
    writeLock(tmp.dir, withAutofix("github-app"));

    expect(() => setupEnv({ outputDir: tmp.dir, format: "gh", environments: ["stg"] })).toThrow(
      'No generated workflow uses the environment "stg". The workflows in .github/tailor.lock use no GitHub Environment.',
    );
  });

  test("are left out when --environment selects environments", () => {
    using tmp = tempDir("setup-env-");
    const lock = withAutofix("github-app", target("branch", "my-app", "stg"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format: "gh", environments: ["stg"], ghRunner: () => null });

    const [stg] = collectEnvironmentRequirements(lock);
    expect(out).toHaveBeenCalledWith(renderGhCommands([stg!]));
  });
});

describe("how to get each value", () => {
  test.each(["branch", "tag", "preview"] as const)(
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

  test("says that without the required permission machine users can be neither viewed nor created", () => {
    const [clientId] = targetRequirements("branch");

    expect(clientId?.howTo).toContain("without the required permission");
    expect(clientId?.howTo).toContain("cannot view or create machine users");
    expect(clientId?.howTo).not.toContain("admin role");
  });
});

describe("collectEnvironmentRequirements", () => {
  test("lists the credentials and workspace id a branch target needs", () => {
    const [env] = collectEnvironmentRequirements(lockOf(target("branch", "my-app", "stg")));

    expect(env?.environment).toBe("stg");
    expect(env?.requirements.filter((r) => r.required).map((r) => [r.type, r.name])).toEqual([
      ["variable", "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID"],
      ["secret", "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET"],
      ["variable", "TAILOR_PLATFORM_WORKSPACE_ID"],
    ]);
  });

  describe("migration test", () => {
    const withMigrationTest = (inputs: Partial<LockTarget["inputs"]> = {}) => {
      const branch = target("branch", "my-app", "stg");
      return lockOf({
        ...branch,
        inputs: {
          ...branch.inputs,
          migrationTest: true,
          migrationTestLabel: "tailor:migration-test",
          ...inputs,
        },
      });
    };

    test("asks for no extra secrets or variables when it shares the deploy environment", () => {
      const environments = collectEnvironmentRequirements(withMigrationTest());

      expect(environments.map((e) => e.environment)).toEqual(["stg"]);
      expect(environments[0]?.requirements).toEqual(
        collectEnvironmentRequirements(lockOf(target("branch", "my-app", "stg")))[0]?.requirements,
      );
    });

    test("lists a dedicated environment with its own credentials and source workspace", () => {
      const environments = collectEnvironmentRequirements(
        withMigrationTest({ migrationTestEnvironment: "prod-source" }),
      );
      const dedicated = environments.find((e) => e.environment === "prod-source");

      expect(environments.map((e) => e.environment)).toEqual(["stg", "prod-source"]);
      expect(dedicated?.targets).toEqual(["branch my-app (migration test)"]);
      expect(dedicated?.requirements.map((r) => [r.type, r.name, r.required])).toEqual([
        ["variable", "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID", true],
        ["secret", "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET", true],
        ["variable", "TAILOR_PLATFORM_MIGRATION_TEST_SOURCE_WORKSPACE_ID", true],
      ]);
    });

    test("explains the roles the machine user needs, including creating and deleting the temporary workspace", () => {
      const [, dedicated] = collectEnvironmentRequirements(
        withMigrationTest({ migrationTestEnvironment: "prod-source" }),
      );
      const text = dedicated?.requirements.map((r) => r.description).join("\n");

      expect(text).toMatch(/editor/);
      expect(text).toMatch(/temporary workspace/);
    });

    test("merges into an existing environment of the same name", () => {
      const branch = target("branch", "my-app", "stg");
      const lock = lockOf(branch, target("branch", "other", "prod-source"), {
        ...branch,
        workspaceName: "third",
        inputs: { ...branch.inputs, migrationTest: true, migrationTestEnvironment: "PROD-SOURCE" },
      });
      const names = collectEnvironmentRequirements(lock)
        .find((e) => e.environment === "prod-source")
        ?.requirements.map((r) => r.name);

      expect(names).toContain("TAILOR_PLATFORM_MIGRATION_TEST_SOURCE_WORKSPACE_ID");
    });

    test("keeps the plan and deploy wording when the dedicated environment is the deploy environment", () => {
      const [env] = collectEnvironmentRequirements(
        withMigrationTest({ migrationTestEnvironment: "STG" }),
      );
      const clientId = env?.requirements.find(
        (r) => r.name === "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID",
      );

      expect(env?.targets).toEqual(["branch my-app", "branch my-app (migration test)"]);
      expect(clientId?.description).toMatch(/plan and deploy/);
    });

    test("matches the secrets and variables the rendered job references", () => {
      const { content } = renderBranchWorkflow({
        workspaceName: "my-app",
        environment: "stg",
        packageManager: "pnpm",
        branch: "main",
        erdPreview: null,
        migrationTest: { label: "x", environment: "prod-source" },
      });
      const job = content.slice(
        content.indexOf("  tailor-migration-test:"),
        content.indexOf("  tailor-deploy:"),
      );
      const [, dedicated] = collectEnvironmentRequirements(
        withMigrationTest({ migrationTestEnvironment: "prod-source" }),
      );

      expect(referencedNames(job)).toEqual(
        dedicated?.requirements.map((r) => `${r.type} ${r.name}`).toSorted(),
      );
    });
  });

  test("marks Slack notification and fail-on-drift settings as optional", () => {
    const [env] = collectEnvironmentRequirements(lockOf(target("branch", "my-app", "stg")));

    expect(env?.requirements.filter((r) => !r.required).map((r) => r.name)).toEqual([
      "TAILOR_PLATFORM_FAIL_ON_DRIFT",
      "TAILOR_SLACK_BOT_TOKEN",
      "TAILOR_SLACK_CHANNEL_ID",
      "SEED_USER_PASSWORD",
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

    expect(lines).toContain("gh variable set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env=stg/eu");
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

  test("tells GitHub Enterprise Server users to point gh api at their host, since gh cannot tell it", () => {
    expect(renderGhCommands(envs())).toMatch(/^# On GitHub Enterprise Server, export GH_HOST=/m);
    expect(renderGhCommands(envs(), { owner: "acme", name: "app" })).not.toContain("GH_HOST");
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
      "gh variable set TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID --env=production --repo=tailor-platform/sdk",
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
    expect(hcl).not.toContain("GITHUB_BASE_URL");
  });
});

describe("when the repository is on a GitHub Enterprise Server host", () => {
  const repository = { host: "ghe.example.com", owner: "acme", name: "app" };
  const envs = () => collectEnvironmentRequirements(lockOf(target("tag", "my-app", "production")));

  test("gh commands send every request to that host instead of gh's default host", () => {
    const lines = renderGhCommands(envs(), repository).split("\n");

    expect(lines).toContain(
      'if [ "$(gh api --hostname ghe.example.com -i "repos/acme/app/environments/production" 2>/dev/null | head -n 1 | cut -d " " -f 2)" = 404 ]; then ' +
        'gh api --hostname ghe.example.com -X PUT "repos/acme/app/environments/production" --silent; fi',
    );
    expect(lines).toContain(
      "gh secret set TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET --env=production --repo=ghe.example.com/acme/app",
    );
    expect(lines).toContain(
      "gh variable set TAILOR_PLATFORM_WORKSPACE_ID --env=production --repo=ghe.example.com/acme/app",
    );
  });

  test("Terraform instructions point the provider at that host", () => {
    expect(renderTerraform(envs(), repository)).toContain(
      "#   export GITHUB_TOKEN=<token> GITHUB_OWNER=acme GITHUB_BASE_URL=https://ghe.example.com/",
    );
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

  test("tells GitHub Enterprise Server users to point the provider at their host, since it is unknown", () => {
    expect(renderTerraform(envs())).toContain(
      "#   On GitHub Enterprise Server, also export GITHUB_BASE_URL=https://<host>/",
    );
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
    expect(hcl).toContain("#   export TF_VAR_stg_eu_tailor_platform_machine_user_client_secret=");
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
  const noGh: GhRunner = () => null;

  test("fails when no lock exists", () => {
    using tmp = tempDir("setup-env-");

    expect(() => setupEnv({ outputDir: tmp.dir, format: "gh" })).toThrow(/tailor\.lock/);
  });

  test.each([
    ["gh", renderGhCommands],
    ["terraform", renderTerraform],
  ] as const)("prints the %s output to stdout", (format, render) => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format, ghRunner: noGh });

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

  test.each([
    ["gh", renderGhCommands],
    ["terraform", renderTerraform],
  ] as const)(
    "asks gh for the repository and its host when origin is not on github.com (%s)",
    (format, render) => {
      using tmp = tempDir("setup-env-");
      const lock = lockOf(target("branch", "my-app", "stg"));
      writeLock(tmp.dir, lock);
      using out = vi.spyOn(logger, "out").mockImplementation(() => {});
      const ghRunner: GhRunner = (args) =>
        args.join(" ") === "repo view --json nameWithOwner,url"
          ? {
              status: 0,
              stdout: JSON.stringify({
                nameWithOwner: "acme/app",
                url: "https://ghe.example.com/acme/app",
              }),
              stderr: "",
            }
          : null;

      setupEnv({
        outputDir: tmp.dir,
        format,
        gitRunner: () => "git@ghe.example.com:acme/app.git",
        ghRunner,
      });

      expect(out).toHaveBeenCalledWith(
        render(collectEnvironmentRequirements(lock), {
          host: "ghe.example.com",
          owner: "acme",
          name: "app",
        }),
      );
    },
  );

  test("leaves the repository to gh at run time when gh cannot tell it", () => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({
      outputDir: tmp.dir,
      format: "gh",
      gitRunner: () => "git@ghe.example.com:acme/app.git",
      ghRunner: () => ({
        status: 1,
        stdout: "",
        stderr:
          "none of the git remotes configured for this repository point to a known GitHub host\n",
      }),
    });

    expect(out).toHaveBeenCalledWith(renderGhCommands(collectEnvironmentRequirements(lock)));
  });

  test("prints only the environments passed with --environment, ignoring case", () => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"), target("tag", "my-app", "production"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format: "gh", environments: ["Production"], ghRunner: noGh });

    const [, production] = collectEnvironmentRequirements(lock);
    expect(out).toHaveBeenCalledWith(renderGhCommands([production!]));
  });

  test("prints an environment once even when --environment names it twice", () => {
    using tmp = tempDir("setup-env-");
    const lock = lockOf(target("branch", "my-app", "stg"), target("tag", "my-app", "production"));
    writeLock(tmp.dir, lock);
    using out = vi.spyOn(logger, "out").mockImplementation(() => {});

    setupEnv({ outputDir: tmp.dir, format: "gh", environments: ["stg", "STG"], ghRunner: noGh });

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
