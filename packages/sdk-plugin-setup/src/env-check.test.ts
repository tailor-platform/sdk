import { logger } from "@tailor-platform/sdk/cli";
import { describe, expect, test, vi } from "vitest";
import { checkEnv } from "./env-check";
import { LOCK_VERSION, type LockTarget, writeLock } from "./lock";
import { autofixLockEntry } from "./test-helpers/autofix";
import { envTarget as target } from "./test-helpers/env-target";
import { tempDir } from "./test-helpers/temp-dir";
import type { GhOutput, GhRunner } from "./gh";
import type { GitRunner } from "./git";

const CLIENT_ID = "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID";
const CLIENT_SECRET = "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET";
const WORKSPACE_ID = "TAILOR_PLATFORM_WORKSPACE_ID";

type Entries = { secrets?: readonly string[]; variables?: readonly string[] };

type FakeGitHub = Entries & {
  host?: string;
  repo?: { full_name: string; owner: { type: string }; permissions?: Record<string, boolean> };
  environments?: Record<string, Entries>;
  organization?: Entries;
  /** Raw results keyed by API path (without query), replacing the simulated ones. */
  responses?: Record<string, GhOutput | null>;
};

const ok = (stdout: string): GhOutput => ({ status: 0, stdout, stderr: "" });
const httpError = (code: number, message: string): GhOutput => ({
  status: 1,
  stdout: JSON.stringify({ message, status: String(code) }),
  stderr: `gh: ${message} (HTTP ${String(code)})\n`,
});
const names = (list: readonly string[] = []) => ok(list.map((name) => `${name}\n`).join(""));

/**
 * Simulate the GitHub REST API behind `gh api`.
 * @param github - Repository state
 * @returns Runner recording every call
 */
function fakeGh(github: FakeGitHub = {}): GhRunner & { calls: string[][] } {
  const repo = github.repo ?? {
    full_name: "acme/app",
    owner: { type: "Organization" },
    permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
  };
  const environments = new Map(
    Object.entries(github.environments ?? {}).map(([name, entries]) => [
      name.toLowerCase(),
      entries,
    ]),
  );
  const respond = (path: string): GhOutput | null => {
    if (github.responses && path in github.responses) return github.responses[path] ?? null;
    const match = /^repos\/[^/]+\/[^/]+(\/.*)?$/.exec(path);
    if (!match) return httpError(404, "Not Found");
    const rest = match[1] ?? "";
    if (rest === "") return ok(JSON.stringify(repo));
    if (rest === "/actions/secrets") return names(github.secrets);
    if (rest === "/actions/variables") return names(github.variables);
    if (rest.startsWith("/actions/organization-")) {
      if (repo.owner.type !== "Organization") return httpError(422, "Validation Failed");
      return names(
        rest.endsWith("secrets") ? github.organization?.secrets : github.organization?.variables,
      );
    }
    const env = /^\/environments\/([^/]+)(\/secrets|\/variables)?$/.exec(rest);
    if (env) {
      const entries = environments.get(decodeURIComponent(env[1]!).toLowerCase());
      if (!entries) return httpError(404, "Not Found");
      if (env[2] === "/secrets") return names(entries.secrets);
      if (env[2] === "/variables") return names(entries.variables);
      return ok(JSON.stringify({ name: decodeURIComponent(env[1]!) }));
    }
    return httpError(404, "Not Found");
  };
  const calls: string[][] = [];
  const run: GhRunner = (args) => {
    calls.push(args);
    if (args[0] === "repo" && args[1] === "view") {
      if (github.responses && "repo view" in github.responses) {
        return github.responses["repo view"] ?? null;
      }
      const url = `https://${github.host ?? "github.com"}/${repo.full_name}`;
      return ok(JSON.stringify({ nameWithOwner: repo.full_name, url }));
    }
    const path = args.find((arg) => arg.startsWith("repos/"));
    return respond(path?.split("?")[0] ?? "");
  };
  return Object.assign(run, { calls });
}

function captureOutput() {
  const stderr: string[] = [];
  const stdout: unknown[] = [];
  const spies = [
    ...(["info", "success", "warn", "error", "log"] as const).map((method) =>
      vi.spyOn(logger, method).mockImplementation((message: string) => {
        stderr.push(message);
      }),
    ),
    vi.spyOn(logger, "out").mockImplementation((data: unknown) => {
      stdout.push(data);
    }),
  ];
  return {
    stderr: () => stderr.join("\n"),
    stdout: () => stdout.filter((data) => typeof data === "string").join(""),
    data: () => stdout.find((data) => typeof data !== "string"),
    [Symbol.dispose]() {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

const origin = () => "git@github.com:acme/app.git";

function setup(...targets: LockTarget[]) {
  const tmp = tempDir("setup-env-check-");
  writeLock(tmp.dir, {
    version: LOCK_VERSION,
    targets: targets.length > 0 ? targets : [target("branch", "my-app", "stg")],
  });
  return tmp;
}

describe("checkEnv for the autofix workflow", () => {
  const APP_CLIENT_ID = "TAILOR_AUTOFIX_APP_CLIENT_ID";
  const APP_PRIVATE_KEY = "TAILOR_AUTOFIX_APP_PRIVATE_KEY";

  function setupAutofixLock() {
    const tmp = tempDir("setup-env-check-");
    writeLock(tmp.dir, {
      version: LOCK_VERSION,
      targets: [],
      autofix: autofixLockEntry("github-app"),
    });
    return tmp;
  }

  test("fails when the GitHub App settings are missing from the repository", () => {
    using tmp = setupAutofixLock();
    using output = captureOutput();
    const gh = fakeGh({ variables: [APP_CLIENT_ID] });

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh })).toThrow(
      /1 required secret or variable is missing/,
    );
    expect(output.stderr()).toContain("Repository secrets and variables (autofix)");
    expect(output.stderr()).toContain(`✔ ${APP_CLIENT_ID} (variable, set on the repository)`);
    expect(output.stderr()).toContain(`✖ ${APP_PRIVATE_KEY} (secret): missing`);
    expect(output.stdout()).toContain(`gh secret set ${APP_PRIVATE_KEY} --repo=acme/app`);
    expect(gh.calls.some((args) => args.some((arg) => arg.includes("/environments/")))).toBe(false);
  });

  test("counts settings on the organization as registered", () => {
    using tmp = setupAutofixLock();
    using output = captureOutput();
    const gh = fakeGh({ organization: { secrets: [APP_PRIVATE_KEY], variables: [APP_CLIENT_ID] } });

    checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh });

    expect(output.stderr()).toContain(`✔ ${APP_PRIVATE_KEY} (secret, set on the organization)`);
  });
});

describe("checkEnv", () => {
  test("fails when an environment lacks a required secret, naming it", () => {
    using tmp = setup();
    using output = captureOutput();
    const gh = fakeGh({ environments: { stg: { variables: [CLIENT_ID, WORKSPACE_ID] } } });

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh })).toThrow(
      /1 required secret or variable is missing/,
    );
    expect(output.stderr()).toMatch(new RegExp(`${CLIENT_SECRET} \\(secret\\).*missing`));
  });

  test("passes when only optional entries are missing, reporting them as not set", () => {
    using tmp = setup();
    using output = captureOutput();
    const gh = fakeGh({
      environments: { stg: { secrets: [CLIENT_SECRET], variables: [CLIENT_ID, WORKSPACE_ID] } },
    });

    checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh });

    expect(output.stderr()).toMatch(/TAILOR_SLACK_BOT_TOKEN \(secret\): optional, not set/);
    expect(output.stderr()).toMatch(/All required secrets and variables are registered/);
  });

  test.each([
    ["repository", { secrets: [CLIENT_SECRET] }],
    ["organization", { organization: { secrets: [CLIENT_SECRET] } }],
  ] as const)(
    "counts a secret set on the %s as registered, since the workflow reads it from there",
    (scope, github) => {
      using tmp = setup();
      using output = captureOutput();
      const gh = fakeGh({
        ...github,
        environments: { stg: { variables: [CLIENT_ID, WORKSPACE_ID] } },
      });

      checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh });

      expect(output.stderr()).toContain(`✔ ${CLIENT_SECRET} (secret, set on the ${scope})`);
    },
  );

  test("skips organization-level entries for a repository a user owns", () => {
    using tmp = setup();
    using _output = captureOutput();
    const gh = fakeGh({
      repo: { full_name: "alice/app", owner: { type: "User" }, permissions: { push: true } },
      environments: { stg: { secrets: [CLIENT_SECRET], variables: [CLIENT_ID, WORKSPACE_ID] } },
    });

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh })).not.toThrow();
  });

  test("reports an environment that does not exist yet, with every required entry it lacks", () => {
    using tmp = setup();
    using output = captureOutput();

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: fakeGh() })).toThrow(
      /3 required secrets or variables are missing/,
    );
    expect(output.stderr()).toMatch(
      /Environment "stg" \(branch my-app\) does not exist in acme\/app/,
    );
  });

  test("prints gh commands that set only the missing entries, with where each value comes from", () => {
    using tmp = setup();
    using output = captureOutput();
    const gh = fakeGh({
      environments: { stg: { secrets: [CLIENT_SECRET], variables: [CLIENT_ID] } },
    });

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh })).toThrow(
      /1 required/,
    );

    const lines = output.stdout().split("\n");
    expect(lines).toContain(`gh variable set ${WORKSPACE_ID} --env=stg --repo=acme/app`);
    expect(lines).toContain("# gh secret set TAILOR_SLACK_BOT_TOKEN --env=stg --repo=acme/app");
    expect(lines.filter((line) => line.includes(CLIENT_ID))).toEqual([]);
    expect(lines.filter((line) => line.includes(CLIENT_SECRET))).toEqual([]);
    expect(output.stdout()).toMatch(/How to get: .*`tailor workspace list`/);
    expect(output.stdout()).not.toContain("gh api -X PUT");
  });

  test("includes the command that creates an environment that does not exist yet", () => {
    using tmp = setup();
    using output = captureOutput();

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: fakeGh() })).toThrow(
      /3 required/,
    );

    expect(output.stdout()).toContain('gh api -X PUT "repos/acme/app/environments/stg" --silent');
  });

  test("accepts the client ID stored as a secret, the deprecated fallback, and asks to move it", () => {
    using tmp = setup();
    using output = captureOutput();
    const gh = fakeGh({
      environments: { stg: { secrets: [CLIENT_SECRET, CLIENT_ID], variables: [WORKSPACE_ID] } },
    });

    checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh });

    expect(output.stderr()).toContain(
      `⚠ ${CLIENT_ID} (variable): set as a secret, a deprecated fallback; set it as a variable and delete the secret`,
    );
    expect(output.stdout().split("\n")).toContain(
      `gh variable set ${CLIENT_ID} --env=stg --repo=acme/app`,
    );
  });

  test("points out an entry set as the other kind, which the workflow does not read", () => {
    using tmp = setup();
    using output = captureOutput();
    const gh = fakeGh({
      secrets: [WORKSPACE_ID],
      environments: { stg: { secrets: [CLIENT_SECRET], variables: [CLIENT_ID] } },
    });

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh })).toThrow(
      /1 required/,
    );
    expect(output.stderr()).toContain(
      `✖ ${WORKSPACE_ID} (variable): missing; a secret of this name is set on the repository, but the workflow reads a variable`,
    );
  });

  test("checks only the environments passed with --environment", () => {
    using tmp = setup(target("branch", "my-app", "stg"), target("tag", "my-app", "production"));
    using output = captureOutput();
    const gh = fakeGh({
      environments: {
        production: { secrets: [CLIENT_SECRET], variables: [CLIENT_ID, WORKSPACE_ID] },
      },
    });

    checkEnv({
      outputDir: tmp.dir,
      environments: ["Production"],
      gitRunner: origin,
      ghRunner: gh,
    });

    expect(output.stderr()).not.toContain('"stg"');
    expect(gh.calls.flat().filter((arg) => arg.includes("/environments/stg"))).toEqual([]);
  });

  test("asks gh for the repository and its host when origin is not on github.com", () => {
    using tmp = setup();
    using output = captureOutput();
    const gh = fakeGh({ host: "ghe.example.com" });

    expect(() =>
      checkEnv({
        outputDir: tmp.dir,
        gitRunner: () => "git@ghe.example.com:acme/app.git",
        ghRunner: gh,
      }),
    ).toThrow(/3 required/);

    const apiCalls = gh.calls.filter(([command]) => command === "api");
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const args of apiCalls) {
      expect(args.slice(1, 3)).toEqual(["--hostname", "ghe.example.com"]);
      expect(args.find((arg) => arg.startsWith("repos/"))).toMatch(/^repos\/acme\/app\b/);
    }
    expect(output.stderr().split("\n")[0]).toBe(
      "Checking the GitHub Environment secrets and variables of acme/app",
    );
    const lines = output.stdout().split("\n");
    expect(lines).toContain(
      'if [ "$(gh api --hostname ghe.example.com -i "repos/acme/app/environments/stg" 2>/dev/null | head -n 1 | cut -d " " -f 2)" = 404 ]; then ' +
        'gh api --hostname ghe.example.com -X PUT "repos/acme/app/environments/stg" --silent; fi',
    );
    expect(lines).toContain(
      `gh secret set ${CLIENT_SECRET} --env=stg --repo=ghe.example.com/acme/app`,
    );
    expect(lines).toContain(
      `gh variable set ${WORKSPACE_ID} --env=stg --repo=ghe.example.com/acme/app`,
    );
  });

  test("sends its requests to github.com for a github.com origin, whatever gh's default host is", () => {
    using tmp = setup();
    using _output = captureOutput();
    const gh = fakeGh();

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh })).toThrow(
      /3 required/,
    );

    const apiCalls = gh.calls.filter(([command]) => command === "api");
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const args of apiCalls) {
      expect(args.slice(1, 3)).toEqual(["--hostname", "github.com"]);
    }
  });

  test("names the github.com repository gh resolves for an origin it cannot parse, such as an SSH alias", () => {
    using tmp = setup();
    using output = captureOutput();

    expect(() =>
      checkEnv({
        outputDir: tmp.dir,
        gitRunner: () => "git@github-work:acme/app.git",
        ghRunner: fakeGh(),
      }),
    ).toThrow(/3 required/);

    expect(output.stdout()).toContain('gh api -X PUT "repos/acme/app/environments/stg" --silent');
    expect(output.stdout().split("\n")).toContain(
      `gh variable set ${WORKSPACE_ID} --env=stg --repo=acme/app`,
    );
  });

  test("prints the result as data in JSON mode, still failing when a required entry is missing", () => {
    using tmp = setup();
    using output = captureOutput();
    using _json = vi.spyOn(logger, "jsonMode", "get").mockReturnValue(true);
    const gh = fakeGh({
      environments: { stg: { secrets: [CLIENT_SECRET], variables: [CLIENT_ID] } },
    });

    expect(() => checkEnv({ outputDir: tmp.dir, gitRunner: origin, ghRunner: gh })).toThrow(
      /1 required/,
    );

    expect(output.data()).toEqual({
      repository: "acme/app",
      environments: [
        expect.objectContaining({
          environment: "stg",
          targets: ["branch my-app"],
          exists: true,
          requirements: expect.arrayContaining([
            expect.objectContaining({
              name: CLIENT_ID,
              type: "variable",
              required: true,
              registered: true,
              foundIn: "environment",
              otherTypeIn: null,
            }),
            expect.objectContaining({ name: WORKSPACE_ID, registered: false, foundIn: null }),
          ]),
        }),
      ],
    });
    expect(output.stdout()).toBe("");
    expect(output.stderr()).toBe("");
  });
});

describe("checkEnv when gh cannot read the repository", () => {
  const check = (ghRunner: GhRunner, gitRunner: GitRunner = origin) => {
    using tmp = setup();
    using _output = captureOutput();
    checkEnv({ outputDir: tmp.dir, gitRunner, ghRunner });
  };

  test("asks to install gh when it is not installed", () => {
    expect(() => check(() => null)).toThrow(
      /GitHub CLI \(gh\) is not installed.*https:\/\/cli\.github\.com.*`gh auth login`/,
    );
  });

  test.each([
    [
      "is not logged in",
      {
        status: 4,
        stdout: "",
        stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
      },
    ],
    ["has an invalid token", httpError(401, "Bad credentials")],
  ])("asks to log in when gh %s, not blaming permissions", (_, result) => {
    const run = () => check(() => result);

    expect(run).toThrow(/not logged in to GitHub.*`gh auth login`/);
    expect(run).not.toThrow(/permission/);
  });

  test("says how to name the repository when gh cannot tell it from the current directory", () => {
    const gh = fakeGh({
      responses: {
        "repo view": {
          status: 1,
          stdout: "",
          stderr:
            "none of the git remotes configured for this repository point to a known GitHub host\n",
        },
      },
    });

    expect(() => check(gh, () => null)).toThrow(
      /Could not tell which GitHub repository to check.*known GitHub host.*clone of the repository/,
    );
  });

  test("refuses a repository from gh whose host is unsafe to put in the printed commands", () => {
    const gh = fakeGh({ host: "ghe$(id).example.com" });

    expect(() => check(gh, () => null)).toThrow(
      /Could not tell which GitHub repository to check.*cannot be embedded in commands/,
    );
  });

  test("says a repository GitHub cannot find may only be hidden from the account", () => {
    const gh = fakeGh({ responses: { "repos/acme/app": httpError(404, "Not Found") } });

    expect(() => check(gh)).toThrow(
      /acme\/app was not found, or the gh account has no access to it.*private repository/,
    );
  });

  test("names the missing permission when the account can only read the repository", () => {
    const gh = fakeGh({
      repo: {
        full_name: "acme/app",
        owner: { type: "Organization" },
        permissions: { admin: false, maintain: false, push: false, triage: true, pull: true },
      },
    });

    expect(() => check(gh)).toThrow(
      /needs the push \(write\) permission on acme\/app.*only has: triage, pull/,
    );
  });

  test.each([
    ["repos/acme/app/actions/secrets", "repository secrets"],
    ["repos/acme/app/actions/organization-variables", "organization variables"],
    ["repos/acme/app/environments/stg/variables", 'variables of environment "stg"'],
  ])("reports a 403 from %s as a permission error with GitHub's reason", (path, what) => {
    const gh = fakeGh({
      environments: { stg: {} },
      responses: { [path]: httpError(403, "Resource not accessible by personal access token") },
    });

    expect(() => check(gh)).toThrow(
      new RegExp(
        `GitHub denied listing the ${what} of acme/app: Resource not accessible by personal access token`,
      ),
    );
  });

  test.each([
    ["repos/acme/app", /Repository acme\/app could not be read: Server Error/],
    [
      "repos/acme/app/environments/stg",
      /Could not read environment "stg" of acme\/app: Server Error/,
    ],
    [
      "repos/acme/app/actions/variables",
      /Could not list the repository variables of acme\/app: Server Error/,
    ],
  ])("stops with gh's reason when %s fails for another reason", (path, message) => {
    const gh = fakeGh({
      environments: { stg: {} },
      responses: { [path]: httpError(500, "Server Error") },
    });

    expect(() => check(gh)).toThrow(message);
  });
});
