import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { logger } from "@tailor-platform/sdk/cli";
import { parseYAML } from "confbox";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { printAutofixNextSteps, setupAutofix, type AutofixSetupOptions } from "./autofix";
import { LOCK_VERSION, readLock, writeLock, type LockTarget } from "./lock";
import { computeManagedHash } from "./managed";
import {
  AUTOFIX_CODEMODS,
  AUTOFIX_PROVIDERS,
  AUTOFIX_WORKFLOW_FILE,
  TEMPLATE_VERSION,
  type AutofixCodemod,
  type AutofixProvider,
  type PackageManager,
} from "./templates";
import { autofixSetupOptions, renderAutofixFor } from "./test-helpers/autofix";
import { tempDir } from "./test-helpers/temp-dir";

type Step = {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "working-directory"?: string;
};
type Job = {
  if?: string;
  needs?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
};
type Workflow = { name: string; jobs: Record<string, Job> };

const render = renderAutofixFor;

const workflowOf = (provider: AutofixProvider, overrides?: Parameters<typeof render>[1]) =>
  parseYAML(render(provider, overrides).content) as Workflow;

const stepOf = (workflow: Workflow, job: string, id: string): Step => {
  const step = workflow.jobs[job]?.steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`No step ${job}/${id}`);
  return step;
};

const SERVICE_PROVIDERS = ["autofix-ci", "securefix"] as const;

const CODEMODS_ON = AUTOFIX_CODEMODS.filter((codemod) => codemod !== "off");

describe("renderAutofixWorkflow", () => {
  test.each(
    AUTOFIX_PROVIDERS.flatMap((provider) =>
      AUTOFIX_CODEMODS.map((codemod) => [provider, codemod] as const),
    ),
  )(
    "%s, codemod %s: lists exactly the jobs and steps it generates as managed",
    (provider, codemod) => {
      for (const dirs of [["."], ["apps/a", "apps/b"]]) {
        const { content, generatedIds } = render(provider, { dirs, codemod });
        const workflow = parseYAML(content) as Workflow;
        const ids = Object.entries(workflow.jobs).flatMap(([job, { steps }]) => [
          job,
          ...steps.map((step) => `${job}/${String(step.id)}`),
        ]);
        expect(generatedIds.toSorted()).toEqual(ids.toSorted());
      }
    },
  );

  test.each(CODEMODS_ON)(
    "codemod %s: fetches the base lockfile before the project's code runs, and runs the codemods before tailor generate",
    (codemod) => {
      const ids = (dirs: string[]) =>
        workflowOf("github-token", { codemod, dirs }).jobs["tailor-autofix"]?.steps.map(
          (step) => step.id,
        );
      expect(ids(["."])?.slice(0, 8)).toEqual([
        "tailor-checkout",
        "tailor-codemod-base",
        "tailor-setup",
        "tailor-install",
        "tailor-autofix-baseline",
        "tailor-codemod",
        "tailor-generate",
        "tailor-autofix-diff",
      ]);
      expect(ids(["apps/a", "apps/b"])?.slice(4, 8)).toEqual([
        "tailor-autofix-baseline",
        "tailor-codemod",
        "tailor-generate-apps-a",
        "tailor-generate-apps-b",
      ]);
    },
  );

  test.each(AUTOFIX_PROVIDERS)(
    "%s, codemod error: fails in a job of its own, so the generate job still hands off its fix",
    (provider) => {
      const workflow = workflowOf(provider, { codemod: "error" });
      expect(workflow.jobs["tailor-autofix"]?.outputs?.["codemod-pending"]).toBe(
        "${{ steps.tailor-codemod.outputs.pending }}",
      );
      const result = workflow.jobs["tailor-codemod-result"];
      expect(result?.needs).toBe("tailor-autofix");
      expect(result?.if).toBe("needs.tailor-autofix.outputs.codemod-pending == 'true'");
      expect(result?.permissions).toEqual({ contents: "read" });
      expect(result?.steps.map((step) => step.id)).toEqual(["tailor-codemod-result"]);
      expect(result?.steps[0]?.run).toMatch(/^echo "::error::[^"]+"\nexit 1\n$/);
    },
  );

  test.each(["warn", "deterministic"] as const)(
    "codemod %s: never fails on what the codemods leave",
    (codemod) => {
      for (const provider of AUTOFIX_PROVIDERS) {
        const workflow = workflowOf(provider, { codemod });
        expect(workflow.jobs["tailor-codemod-result"]).toBeUndefined();
        expect(workflow.jobs["tailor-autofix"]?.outputs?.["codemod-pending"]).toBeUndefined();
      }
    },
  );

  test.each(AUTOFIX_PROVIDERS)("%s, codemod off: adds no codemod step", (provider) => {
    const { content, generatedIds } = render(provider);
    expect(generatedIds.filter((id) => id.includes("codemod"))).toEqual([]);
    expect(content).not.toContain("tailor upgrade");
  });

  test("gives autofix.ci and securefix the workflow names they accept requests from", () => {
    expect(
      Object.fromEntries(
        AUTOFIX_PROVIDERS.map((provider) => [provider, workflowOf(provider).name]),
      ),
    ).toEqual({
      "github-token": "Tailor Autofix",
      "autofix-ci": "autofix.ci",
      securefix: "securefix",
      "github-app": "Tailor Autofix",
    });
  });

  test.each(["github-token", "securefix", "github-app"] as const)(
    "%s: skips pull requests from other repositories and Dependabot, which get no write token or secrets",
    (provider) => {
      expect(workflowOf(provider).jobs["tailor-autofix"]?.if).toBe(
        "github.event.pull_request.head.repo.full_name == github.repository &&\ngithub.actor != 'dependabot[bot]'",
      );
    },
  );

  test("autofix-ci: runs for fork pull requests too, which the autofix.ci App commits to", () => {
    expect(workflowOf("autofix-ci").jobs["tailor-autofix"]?.if).toBeUndefined();
  });

  test.each(AUTOFIX_PROVIDERS)(
    "%s: checks out the pull request head, not the merge commit",
    (provider) => {
      const workflow = workflowOf(provider);
      const checkouts = Object.values(workflow.jobs).flatMap(({ steps }) =>
        steps.filter((step) => step.uses?.startsWith("actions/checkout@")),
      );
      expect(checkouts.length).toBeGreaterThan(0);
      for (const checkout of checkouts) {
        expect(checkout.with?.ref).toBe("${{ github.event.pull_request.head.sha }}");
      }
    },
  );

  test.each([
    ["pnpm", "pnpm exec tailor generate"],
    ["npm", "npx @tailor-platform/sdk generate"],
    ["yarn", "yarn tailor generate"],
    ["bun", "bun run tailor generate"],
  ] as const)("runs tailor generate with %s", (packageManager, command) => {
    const workflow = workflowOf("github-token", { packageManager });
    expect(stepOf(workflow, "tailor-autofix", "tailor-generate").run).toBe(command);
  });

  test("runs tailor generate in the app directory", () => {
    const root = workflowOf("github-token");
    expect(stepOf(root, "tailor-autofix", "tailor-generate")["working-directory"]).toBeUndefined();

    const single = workflowOf("github-token", { dirs: ["apps/api"] });
    expect(stepOf(single, "tailor-autofix", "tailor-generate")["working-directory"]).toBe(
      "apps/api",
    );

    const multi = workflowOf("github-token", { dirs: ["apps/erp", "apps/users"] });
    const generates = multi.jobs["tailor-autofix"]?.steps.filter((step) =>
      step.id?.startsWith("tailor-generate"),
    );
    expect(generates?.map((step) => [step.id, step["working-directory"]])).toEqual([
      ["tailor-generate-apps-erp", "apps/erp"],
      ["tailor-generate-apps-users", "apps/users"],
    ]);
  });

  test.each([
    ["github-token", ["tailor-checkout", "tailor-download-patch", "tailor-commit"]],
    [
      "github-app",
      ["tailor-app-token", "tailor-checkout", "tailor-download-patch", "tailor-commit"],
    ],
  ] as const)(
    "%s: commits from a separate job that installs and runs none of the project's code",
    (provider, steps) => {
      const push = workflowOf(provider).jobs["tailor-autofix-push"];
      expect(push?.needs).toBe("tailor-autofix");
      expect(push?.if).toBe("needs.tailor-autofix.outputs.changed == 'true'");
      expect(push?.steps.map((step) => step.id)).toEqual(steps);
    },
  );

  test("github-token: commits with the workflow token, which needs contents: write", () => {
    const workflow = workflowOf("github-token");
    expect(workflow.jobs["tailor-autofix-push"]?.permissions).toEqual({ contents: "write" });
    expect(stepOf(workflow, "tailor-autofix-push", "tailor-commit").env?.GH_TOKEN).toBe(
      "${{ github.token }}",
    );
  });

  test("github-app: commits with a GitHub App token, so the workflow token stays read-only", () => {
    const workflow = workflowOf("github-app");
    expect(workflow.jobs["tailor-autofix-push"]?.permissions).toEqual({ contents: "read" });
    expect(stepOf(workflow, "tailor-autofix-push", "tailor-app-token").with).toEqual({
      "client-id": "${{ vars.TAILOR_AUTOFIX_APP_CLIENT_ID }}",
      "private-key": "${{ secrets.TAILOR_AUTOFIX_APP_PRIVATE_KEY }}",
      "permission-contents": "write",
    });
    expect(stepOf(workflow, "tailor-autofix-push", "tailor-commit").env?.GH_TOKEN).toBe(
      "${{ steps.tailor-app-token.outputs.token }}",
    );
  });

  test.each(SERVICE_PROVIDERS)(
    "%s: hands the changes to the service instead of committing itself",
    (provider) => {
      const workflow = workflowOf(provider);
      expect(Object.keys(workflow.jobs)).toEqual(["tailor-autofix"]);
      expect(workflow.jobs["tailor-autofix"]?.permissions).toEqual({ contents: "read" });
    },
  );

  test("autofix-ci: lets autofix.ci fetch the pull request head of a private repository", () => {
    const workflow = workflowOf("autofix-ci");
    const steps = workflow.jobs["tailor-autofix"]?.steps.map((step) => step.id);
    expect(steps?.slice(-2)).toEqual(["tailor-autofix-ci-auth", "tailor-autofix-ci"]);
    expect(stepOf(workflow, "tailor-autofix", "tailor-autofix-ci").uses).toMatch(
      /^autofix-ci\/action@[0-9a-f]{40}$/,
    );
  });

  test("securefix: requests the fix from the server repository with the client App", () => {
    const step = stepOf(workflowOf("securefix"), "tailor-autofix", "tailor-securefix");
    expect(step.uses).toMatch(/^csm-actions\/securefix-action@[0-9a-f]{40}$/);
    expect(step.with).toMatchObject({
      action: "client",
      client_id: "${{ vars.TAILOR_AUTOFIX_APP_CLIENT_ID }}",
      app_private_key: "${{ secrets.TAILOR_AUTOFIX_APP_PRIVATE_KEY }}",
      server_repository: "securefix-server",
    });
  });

  test("gives the fix commit the message the loop guard looks for", () => {
    const guard = (provider: AutofixProvider) =>
      stepOf(workflowOf(provider), "tailor-autofix", "tailor-autofix-diff").env?.COMMIT_MESSAGE;
    const message = guard("github-token");
    expect(message).toEqual(expect.any(String));
    expect(
      stepOf(workflowOf("github-token"), "tailor-autofix-push", "tailor-commit").env
        ?.COMMIT_MESSAGE,
    ).toBe(message);
    expect(
      stepOf(workflowOf("autofix-ci"), "tailor-autofix", "tailor-autofix-ci").with?.[
        "commit-message"
      ],
    ).toBe(message);
    expect(
      stepOf(workflowOf("securefix"), "tailor-autofix", "tailor-securefix").with?.commit_message,
    ).toBe(message);
    for (const provider of AUTOFIX_PROVIDERS) expect(guard(provider)).toBe(message);
  });

  test("deterministic: names tailor upgrade in the loop guard, keeping the fix commit's message", () => {
    const diff = (codemod: AutofixCodemod) =>
      stepOf(workflowOf("github-token", { codemod }), "tailor-autofix", "tailor-autofix-diff");
    for (const codemod of AUTOFIX_CODEMODS) {
      expect(diff(codemod).env?.COMMIT_MESSAGE).toBe("chore: run tailor generate");
    }
    expect(diff("deterministic").run).toContain(
      "::error::tailor upgrade and tailor generate changed files again",
    );
    for (const codemod of ["off", "warn", "error"] as const) {
      expect(diff(codemod).run).toContain("::error::tailor generate changed files again");
    }
  });
});

type StepOutputs = Record<string, Record<string, string>>;

/**
 * Run workflow steps with bash the way a runner does, without the developer's git config.
 * @param obj - Run inputs
 * @param obj.workflow - Parsed workflow
 * @param obj.job - Job id
 * @param obj.steps - Step ids, run in order
 * @param obj.cwd - Checkout directory
 * @param obj.runnerTemp - RUNNER_TEMP directory
 * @param obj.context - Values for the `${{ }}` expressions in step `env`, besides step outputs
 * @param obj.outputs - Outputs of steps that ran before
 * @param obj.env - Extra environment variables
 * @returns The outputs of every step so far, what the steps printed, and the output of the step
 *   that failed, if any
 */
function runSteps(obj: {
  workflow: Workflow;
  job: string;
  steps: string[];
  cwd: string;
  runnerTemp: string;
  context?: Record<string, string>;
  outputs?: StepOutputs;
  env?: Record<string, string>;
}): { outputs: StepOutputs; log: string; failure?: string } {
  const outputs: StepOutputs = { ...obj.outputs };
  let log = "";
  const resolve = (expression: string): string | undefined => {
    const [scope, id, kind, name] = expression.split(".");
    return scope === "steps" && kind === "outputs"
      ? outputs[id ?? ""]?.[name ?? ""]
      : obj.context?.[expression];
  };
  for (const id of obj.steps) {
    const step = stepOf(obj.workflow, obj.job, id);
    const env = Object.fromEntries(
      Object.entries(step.env ?? {}).map(([key, value]) => [
        key,
        value.replaceAll(/\$\{\{ ([\w.-]+) \}\}/g, (_match, expression: string) => {
          const resolved = resolve(expression);
          if (resolved === undefined) throw new Error(`No test value for ${expression}`);
          return resolved;
        }),
      ]),
    );
    const outputFile = path.join(obj.runnerTemp, `output-${id}`);
    fs.writeFileSync(outputFile, "");
    // GitHub runs `run` with `bash -e`, without pipefail.
    const result = spawnSync("bash", ["-e", "-c", String(step.run)], {
      cwd: obj.cwd,
      encoding: "utf-8",
      env: {
        ...GIT_ENV,
        HOME: obj.runnerTemp,
        GITHUB_OUTPUT: outputFile,
        GITHUB_SERVER_URL: "https://github.com",
        RUNNER_TEMP: obj.runnerTemp,
        ...obj.env,
        ...env,
      },
    });
    outputs[id] = Object.fromEntries(
      fs
        .readFileSync(outputFile, "utf-8")
        .split("\n")
        .filter((entry) => entry.includes("="))
        .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
    );
    log += `${result.stdout}${result.stderr}`;
    if (result.status !== 0) return { outputs, log, failure: `${result.stdout}${result.stderr}` };
  }
  return { outputs, log };
}

// A runner has no git identity; keep the developer's from making the scripts pass.
const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf-8", env: GIT_ENV },
  ).trim();
}

const BINARY = Buffer.from([0x00, 0x01, 0x02, 0xff]);

/**
 * Run the generate job's steps around a stand-in for `tailor generate`, in a checkout where an
 * earlier step left an `.npmrc`.
 * @param provider - Provider whose workflow to run
 * @param root - Scratch directory
 * @param options - How the run goes
 * @param options.headSubject - Subject of the head commit
 * @param options.generate - What `tailor generate` does in the checkout
 * @returns The checkout, its RUNNER_TEMP, the head commit, and the diff step's result
 */
function runGenerateJob(
  provider: AutofixProvider,
  root: string,
  options: { headSubject?: string; generate?: (checkout: string) => void } = {},
) {
  const checkout = path.join(root, "checkout");
  const runnerTemp = path.join(root, "runner-temp");
  fs.mkdirSync(checkout, { recursive: true });
  fs.mkdirSync(runnerTemp);
  git(checkout, "init", "-q");
  fs.writeFileSync(path.join(checkout, "keep.txt"), "a\n");
  fs.writeFileSync(path.join(checkout, "stale.txt"), "old\n");
  git(checkout, "add", "-A");
  git(checkout, "commit", "-q", "-m", options.headSubject ?? "feature change");
  fs.writeFileSync(path.join(checkout, ".npmrc"), "//registry.example.com/:_authToken=x\n");

  const workflow = workflowOf(provider);
  const run = (steps: string[], outputs?: StepOutputs) =>
    runSteps({ workflow, job: "tailor-autofix", steps, cwd: checkout, runnerTemp, outputs });
  const baseline = run(["tailor-autofix-baseline"]);
  if (baseline.failure !== undefined) throw new Error(baseline.failure);
  (options.generate ?? generateChanges)(checkout);
  const diff = run(["tailor-autofix-diff"], baseline.outputs);
  return { checkout, runnerTemp, head: git(checkout, "rev-parse", "HEAD"), diff };
}

function generateChanges(checkout: string): void {
  fs.writeFileSync(path.join(checkout, "keep.txt"), "b\n");
  fs.rmSync(path.join(checkout, "stale.txt"));
  fs.mkdirSync(path.join(checkout, "dir with space"));
  fs.writeFileSync(path.join(checkout, "dir with space", "ünïcode.txt"), "u\n");
  fs.writeFileSync(path.join(checkout, "data.bin"), BINARY);
}

describe("tailor-autofix job scripts", () => {
  test("reports no change when tailor generate leaves the files as they are", () => {
    using tmp = tempDir("autofix-diff-");
    const { diff, runnerTemp } = runGenerateJob("github-token", tmp.dir, { generate: () => {} });
    expect(diff.failure).toBeUndefined();
    expect(diff.outputs["tailor-autofix-diff"]).toEqual({ changed: "false" });
    expect(fs.existsSync(path.join(runnerTemp, "tailor-autofix.patch"))).toBe(false);
  });

  test("captures only what tailor generate changed, not files earlier steps created", () => {
    using tmp = tempDir("autofix-diff-");
    const { diff, runnerTemp } = runGenerateJob("github-token", tmp.dir);
    expect(diff.failure).toBeUndefined();
    expect(diff.outputs["tailor-autofix-diff"]).toEqual({ changed: "true" });
    const patch = fs.readFileSync(path.join(runnerTemp, "tailor-autofix.patch"), "utf-8");
    expect(patch).toMatch(/keep\.txt[\s\S]*stale\.txt/);
    expect(patch).toContain("data.bin");
    expect(patch).not.toContain(".npmrc");
  });

  test("fails instead of committing again when the head commit is its own fix", () => {
    using tmp = tempDir("autofix-diff-");
    const message = stepOf(workflowOf("github-token"), "tailor-autofix", "tailor-autofix-diff").env
      ?.COMMIT_MESSAGE;
    const { diff, runnerTemp } = runGenerateJob("github-token", tmp.dir, { headSubject: message });
    expect(diff.failure).toContain("::error::");
    expect(fs.existsSync(path.join(runnerTemp, "tailor-autofix.patch"))).toBe(false);
  });

  test.each(SERVICE_PROVIDERS)(
    "%s: leaves only the generated changes in the working tree for the service to pick up",
    (provider) => {
      using tmp = tempDir("autofix-diff-");
      const { diff, checkout } = runGenerateJob(provider, tmp.dir);
      expect(diff.failure).toBeUndefined();
      expect(git(checkout, "diff", "--name-status", "HEAD").split("\n")).toEqual([
        "M\tkeep.txt",
        "D\tstale.txt",
      ]);
      expect(
        git(checkout, "ls-files", "-z", "--others", "--exclude-standard")
          .split("\0")
          .filter(Boolean)
          .toSorted(),
      ).toEqual(["data.bin", "dir with space/ünïcode.txt"]);
      expect(fs.readFileSync(path.join(checkout, "data.bin"))).toEqual(BINARY);
    },
  );
});

/**
 * Put fake commands ahead of the real ones on PATH.
 * @param root - Scratch directory, which gets the commands in its `bin`
 * @param commands - Script of each command, by name
 * @returns The PATH that finds them first
 */
function fakeCommands(root: string, commands: Record<string, string>): string {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const [name, script] of Object.entries(commands)) {
    fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 });
  }
  return `${bin}:${process.env.PATH ?? ""}`;
}

/**
 * Read what the fake commands recorded in the scratch directory's `calls` file.
 * @param root - Scratch directory
 * @returns The recorded calls, one per line
 */
function callsOf(root: string): string {
  const file = path.join(root, "calls");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
}

const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GH_DIR/calls"
case "$*" in
  *"--input"*)
    for arg; do [ "$prev" = "--input" ] && cp "$arg" "$FAKE_GH_DIR/request.json"; prev=$arg; done
    [ -n "$FAKE_GH_FAIL" ] && { echo "gh: $FAKE_GH_FAIL" >&2; exit 1; }
    echo new-commit-oid ;;
  *"query="*) printf '%s\\n' "$FAKE_GH_CURRENT_HEAD" ;;
esac
`;

type CommitRequest = {
  variables: {
    input: {
      branch: { repositoryNameWithOwner: string; branchName: string };
      expectedHeadOid: string;
      message: { headline: string };
      fileChanges: {
        additions: { path: string; contents: string }[];
        deletions: { path: string }[];
      };
    };
  };
};

/**
 * Run the push job's commit step on a fresh checkout of the head, with a fake gh.
 * @param root - Scratch directory
 * @param options - How the run goes
 * @param options.generate - What `tailor generate` does in the generate job
 * @param options.env - Fake gh settings
 * @returns The step result, the head commit, and the request gh received
 */
function runCommitStep(
  root: string,
  options: { generate?: (checkout: string) => void; env?: Record<string, string> } = {},
) {
  const generated = runGenerateJob("github-token", path.join(root, "generate-job"), options);
  if (generated.diff.failure !== undefined) throw new Error(generated.diff.failure);
  const runnerTemp = path.join(root, "push-temp");
  const checkout = path.join(root, "push-checkout");
  fs.mkdirSync(runnerTemp);
  const PATH = fakeCommands(root, { gh: FAKE_GH });
  git(root, "clone", "-q", generated.checkout, checkout);
  fs.copyFileSync(
    path.join(generated.runnerTemp, "tailor-autofix.patch"),
    path.join(runnerTemp, "tailor-autofix.patch"),
  );
  const result = runSteps({
    workflow: workflowOf("github-token"),
    job: "tailor-autofix-push",
    steps: ["tailor-commit"],
    cwd: checkout,
    runnerTemp,
    context: {
      "github.token": "workflow-token",
      "github.repository": "acme/widgets",
      "github.event.pull_request.head.ref": "feature/x",
      "github.event.pull_request.head.sha": generated.head,
    },
    env: {
      PATH,
      FAKE_GH_DIR: root,
      FAKE_GH_CURRENT_HEAD: generated.head,
      ...options.env,
    },
  });
  const requestFile = path.join(root, "request.json");
  const request = fs.existsSync(requestFile)
    ? (JSON.parse(fs.readFileSync(requestFile, "utf-8")) as CommitRequest)
    : undefined;
  return { result, head: generated.head, request };
}

describe("tailor-autofix-push job scripts", () => {
  test("commits the generated changes onto the pull request head", () => {
    using tmp = tempDir("autofix-commit-");
    const { result, request, head } = runCommitStep(tmp.dir);
    expect(result.failure).toBeUndefined();
    const input = request?.variables.input;
    expect(input?.branch).toEqual({
      repositoryNameWithOwner: "acme/widgets",
      branchName: "feature/x",
    });
    expect(input?.expectedHeadOid).toBe(head);
    expect(input?.fileChanges.deletions).toEqual([{ path: "stale.txt" }]);
    expect(
      Object.fromEntries(
        (input?.fileChanges.additions ?? []).map((addition) => [
          addition.path,
          Buffer.from(addition.contents, "base64"),
        ]),
      ),
    ).toEqual({
      "data.bin": BINARY,
      "dir with space/ünïcode.txt": Buffer.from("u\n"),
      "keep.txt": Buffer.from("b\n"),
    });
  });

  test("refuses to commit a symbolic link, which could point at a file on the runner", () => {
    using tmp = tempDir("autofix-commit-");
    const { result, request } = runCommitStep(tmp.dir, {
      generate: (checkout) => fs.symlinkSync("/etc/hosts", path.join(checkout, "hosts")),
    });
    expect(result.failure).toContain("::error::");
    expect(request).toBeUndefined();
  });

  test("leaves the branch alone when it moved on after the run started", () => {
    using tmp = tempDir("autofix-commit-");
    const { result } = runCommitStep(tmp.dir, {
      env: {
        FAKE_GH_FAIL: "Expected branch to point to the old head",
        FAKE_GH_CURRENT_HEAD: "0123456789012345678901234567890123456789",
      },
    });
    expect(result.failure).toBeUndefined();
  });

  test("fails when the commit is refused while the branch still points at the head", () => {
    using tmp = tempDir("autofix-commit-");
    const { result } = runCommitStep(tmp.dir, { env: { FAKE_GH_FAIL: "forbidden" } });
    expect(result.failure).toContain("forbidden");
  });
});

// The base branch's lockfile, or what gh prints when the contents API refuses the request.
const FAKE_CONTENTS_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GH_DIR/calls"
case "$FAKE_GH_STATUS" in
  200) cat "$FAKE_GH_DIR/base-lockfile" ;;
  404)
    echo '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/repos/contents#get-repository-content","status":"404"}'
    echo "gh: Not Found (HTTP 404)" >&2
    exit 1 ;;
  *)
    echo '{"message":"Bad credentials","status":"401"}'
    echo "gh: Bad credentials (HTTP 401)" >&2
    exit 1 ;;
esac
`;

/**
 * Run the step that fetches the base branch's lockfile, with a fake gh.
 * @param root - Scratch directory
 * @param options - How the run goes
 * @param options.packageManager - Package manager the workflow is generated for
 * @param options.headLockfiles - Lockfiles the pull request head has at the repository root
 * @param options.status - HTTP status the contents API answers with
 * @returns The step result, the gh calls, and the RUNNER_TEMP directory
 */
function runCodemodBaseStep(
  root: string,
  options: { packageManager?: PackageManager; headLockfiles?: string[]; status?: number } = {},
) {
  const checkout = path.join(root, "checkout");
  const runnerTemp = path.join(root, "runner-temp");
  for (const dir of [checkout, runnerTemp]) fs.mkdirSync(dir);
  for (const file of options.headLockfiles ?? ["pnpm-lock.yaml"]) {
    fs.writeFileSync(path.join(checkout, file), "head lockfile\n");
  }
  fs.writeFileSync(path.join(root, "base-lockfile"), "base lockfile\n");
  const PATH = fakeCommands(root, { gh: FAKE_CONTENTS_GH });
  const result = runSteps({
    workflow: workflowOf("github-token", {
      codemod: "warn",
      packageManager: options.packageManager ?? "pnpm",
    }),
    job: "tailor-autofix",
    steps: ["tailor-codemod-base"],
    cwd: checkout,
    runnerTemp,
    context: {
      "github.token": "workflow-token",
      "github.repository": "acme/widgets",
      "github.event.pull_request.base.sha": "base-sha",
    },
    env: { PATH, FAKE_GH_DIR: root, FAKE_GH_STATUS: String(options.status ?? 200) },
  });
  return { result, calls: callsOf(root), runnerTemp };
}

describe("tailor-codemod-base step script", () => {
  test("fetches the base branch's copy of the pull request's lockfile", () => {
    using tmp = tempDir("codemod-base-");
    const { result, calls, runnerTemp } = runCodemodBaseStep(tmp.dir);
    expect(result.failure).toBeUndefined();
    const base = path.join(runnerTemp, "tailor-codemod-base", "pnpm-lock.yaml");
    expect(result.outputs["tailor-codemod-base"]).toEqual({ lockfile: "pnpm-lock.yaml", base });
    expect(fs.readFileSync(base, "utf-8")).toBe("base lockfile\n");
    expect(calls).toBe(
      "api -H Accept: application/vnd.github.raw+json repos/acme/widgets/contents/pnpm-lock.yaml?ref=base-sha\n",
    );
  });

  test.each([
    [["package-lock.json"], "package-lock.json"],
    [["package-lock.json", "npm-shrinkwrap.json"], "npm-shrinkwrap.json"],
  ])("npm: with %j at the root, reads %s, as npm does", (headLockfiles, lockfile) => {
    using tmp = tempDir("codemod-base-");
    const { result } = runCodemodBaseStep(tmp.dir, { packageManager: "npm", headLockfiles });
    expect(result.outputs["tailor-codemod-base"]?.lockfile).toBe(lockfile);
  });

  test("reports no base lockfile when the base branch has none", () => {
    using tmp = tempDir("codemod-base-");
    const { result, runnerTemp } = runCodemodBaseStep(tmp.dir, { status: 404 });
    expect(result.failure).toBeUndefined();
    expect(result.outputs["tailor-codemod-base"]).toEqual({ lockfile: "pnpm-lock.yaml", base: "" });
    expect(fs.readdirSync(path.join(runnerTemp, "tailor-codemod-base"))).toEqual([]);
  });

  test("fails when the contents API refuses the request for another reason", () => {
    using tmp = tempDir("codemod-base-");
    const { result } = runCodemodBaseStep(tmp.dir, { status: 401 });
    expect(result.failure).toContain("Bad credentials (HTTP 401)");
  });

  test.each([
    ["pnpm", [], "No pnpm-lock.yaml"],
    ["bun", ["bun.lockb"], "No bun.lock"],
    ["npm", [], "No npm-shrinkwrap.json or package-lock.json"],
  ] as const)(
    "%s: fails without a lockfile it can read at the root (%j)",
    (packageManager, headLockfiles, message) => {
      using tmp = tempDir("codemod-base-");
      const { result, calls } = runCodemodBaseStep(tmp.dir, {
        packageManager,
        headLockfiles: [...headLockfiles],
      });
      expect(result.failure).toContain(`::error::${message} at the repository root.`);
      expect(calls).toBe("");
    },
  );
});

// `pnpm exec tailor upgrade ...`: records where and how it ran, then prints the canned result.
const FAKE_PNPM = `#!/usr/bin/env bash
printf '%s|%s\\n' "$(pwd -P)" "$*" >> "$FAKE_DIR/calls"
if [ -f "$FAKE_DIR/upgrade.sh" ]; then bash "$FAKE_DIR/upgrade.sh"; fi
cat "$FAKE_DIR/upgrade-stdout"
exit "\${FAKE_UPGRADE_STATUS:-0}"
`;

type UpgradeResult = {
  filesModified?: string[];
  llmReviews?: unknown[];
  warnings?: string[];
};

const upgradeStdout = (result: UpgradeResult = {}) =>
  `${JSON.stringify({
    runner: { packageName: "@tailor-platform/sdk-codemod", packageVersion: "0.10.6" },
    codemodsApplied: 0,
    codemodsSkipped: 0,
    filesModified: [],
    warnings: [],
    errors: [],
    llmReviews: [],
    ...result,
  })}\n`;

const pnpmLock = (importers: string) =>
  [
    "lockfileVersion: '9.0'",
    "",
    "catalogs:",
    "  default:",
    "    '@tailor-platform/sdk':",
    "      specifier: 1.0.0",
    "      version: 1.0.0",
    "",
    "importers:",
    "",
    importers,
    "packages:",
    "",
    "  '@tailor-platform/sdk@2.5.0':",
    "    resolution: {integrity: sha512-x}",
    "",
  ].join("\n");

const pnpmImporter = (dir: string, version: string) =>
  [
    `  ${dir}:`,
    "    devDependencies:",
    "      '@tailor-platform/sdk':",
    `        specifier: ^${version}`,
    `        version: ${version}(@types/node@24.13.4)(typescript@5.9.3)`,
    "",
  ].join("\n");

const ROOT_PNPM_LOCK = pnpmLock(pnpmImporter(".", "2.5.0"));

/**
 * Run the codemod step around a fake `pnpm exec tailor upgrade`, in a git checkout.
 * @param root - Scratch directory
 * @param options - How the run goes
 * @param options.codemod - Codemod mode the workflow is generated for
 * @param options.dirs - App directories
 * @param options.lockfile - Lockfile name the base step found
 * @param options.headLock - The pull request's lockfile; defaults to the base branch's with its
 *   SDK 2.4.0 and 2.5.0 moved to 3.0.0
 * @param options.baseLock - The base branch's lockfile, or null when it has none
 * @param options.installed - SDK version installed under each directory's node_modules
 * @param options.files - Other files in the checkout
 * @param options.upgrade - What the fake tailor upgrade does: its stdout, exit status, and a
 *   script it runs in the app directory first
 * @param options.upgrade.stdout - Standard output, or a function of the checkout's real path
 * @param options.upgrade.status - Exit status
 * @param options.upgrade.script - Bash script run in the app directory
 * @returns The step result, the checkout, the fake's calls, and the job summary
 */
function runCodemodStep(
  root: string,
  options: {
    codemod?: Exclude<AutofixCodemod, "off">;
    dirs?: string[];
    lockfile?: string;
    headLock?: string;
    baseLock?: string | null;
    installed?: Record<string, string>;
    files?: Record<string, string>;
    upgrade?: {
      stdout?: string | ((checkout: string) => string);
      status?: number;
      script?: string;
    };
  } = {},
) {
  const checkout = path.join(root, "checkout");
  const runnerTemp = path.join(root, "runner-temp");
  for (const dir of [checkout, runnerTemp]) fs.mkdirSync(dir);
  const dirs = options.dirs ?? ["."];
  const lockfile = options.lockfile ?? "pnpm-lock.yaml";
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(checkout, file)), { recursive: true });
    fs.writeFileSync(path.join(checkout, file), content);
  };
  write(
    lockfile,
    options.headLock ?? (options.baseLock ?? ROOT_PNPM_LOCK).replaceAll(/\b2\.[45]\.0\b/g, "3.0.0"),
  );
  for (const dir of dirs) write(path.join(dir, "tailor.config.ts"), "export default {};\n");
  for (const [dir, version] of Object.entries(options.installed ?? { ".": "3.0.0" })) {
    write(
      path.join(dir, "node_modules/@tailor-platform/sdk/package.json"),
      JSON.stringify({ name: "@tailor-platform/sdk", version }),
    );
  }
  for (const [file, content] of Object.entries(options.files ?? {})) write(file, content);
  git(checkout, "init", "-q");
  git(checkout, "add", "-A");
  git(checkout, "commit", "-q", "-m", "feature change");

  const base = path.join(runnerTemp, "tailor-codemod-base", lockfile);
  const baseLock = options.baseLock === undefined ? ROOT_PNPM_LOCK : options.baseLock;
  if (baseLock !== null) {
    fs.mkdirSync(path.dirname(base));
    fs.writeFileSync(base, baseLock);
  }
  const PATH = fakeCommands(root, { pnpm: FAKE_PNPM });
  const stdout = options.upgrade?.stdout ?? upgradeStdout();
  fs.writeFileSync(
    path.join(root, "upgrade-stdout"),
    typeof stdout === "string" ? stdout : stdout(fs.realpathSync(checkout)),
  );
  if (options.upgrade?.script)
    fs.writeFileSync(path.join(root, "upgrade.sh"), options.upgrade.script);
  const summaryFile = path.join(runnerTemp, "step-summary.md");
  fs.writeFileSync(summaryFile, "");

  const result = runSteps({
    workflow: workflowOf("github-token", { codemod: options.codemod ?? "warn", dirs }),
    job: "tailor-autofix",
    steps: ["tailor-codemod"],
    cwd: checkout,
    runnerTemp,
    outputs: { "tailor-codemod-base": { lockfile, base: baseLock === null ? "" : base } },
    env: {
      PATH,
      FAKE_DIR: root,
      FAKE_UPGRADE_STATUS: String(options.upgrade?.status ?? 0),
      GITHUB_STEP_SUMMARY: summaryFile,
    },
  });
  const realCheckout = fs.realpathSync(checkout);
  const calls = callsOf(root)
    .split("\n")
    .filter(Boolean)
    .map((call) => {
      const [cwd = "", args = ""] = call.split("|");
      return [path.relative(realCheckout, cwd) || ".", args];
    });
  return {
    result,
    checkout: realCheckout,
    calls,
    annotations: result.log.split("\n").filter((line) => line.startsWith("::")),
    summary: fs.readFileSync(summaryFile, "utf-8"),
  };
}

describe("tailor-codemod step script", () => {
  const BERRY_LOCK = [
    "__metadata:",
    "  version: 8",
    "  cacheKey: 10c0",
    "",
    '"@tailor-platform/sdk-plugin-setup@npm:^1.0.0":',
    "  version: 9.9.9",
    "",
    '"@tailor-platform/sdk@npm:2.5.0":',
    "  version: 2.5.0",
    '  resolution: "@tailor-platform/sdk@npm:2.5.0"',
    "  dependencies:",
    '    zod: "npm:^4.0.0"',
    "",
    '"@tailor-platform/sdk@workspace:packages/sdk":',
    "  version: 0.0.0-use.local",
    '  resolution: "@tailor-platform/sdk@workspace:packages/sdk"',
    "",
    '"app@workspace:.":',
    "  version: 0.0.0-use.local",
    '  resolution: "app@workspace:."',
    "  dependencies:",
    '    "@tailor-platform/sdk": "npm:2.5.0"',
    "",
  ].join("\n");
  const classicLock = (...versions: string[]) =>
    [
      "# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.",
      "# yarn lockfile v1",
      "",
      "",
      '"@tailor-platform/sdk-plugin-setup@^1.0.0":',
      '  version "9.9.9"',
      "",
      ...versions.flatMap((version) => [
        `"@tailor-platform/sdk@^${version}", "@tailor-platform/sdk@~${version}":`,
        `  version "${version}"`,
        `  resolved "https://registry.yarnpkg.com/@tailor-platform/sdk/-/sdk-${version}.tgz#abc"`,
        "  dependencies:",
        '    zod "^4.0.0"',
        "",
      ]),
    ].join("\n");
  const BUN_LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "root",
      "devDependencies": {
        "@tailor-platform/sdk": "2.5.0",
      },
    },
    "apps/a": {
      "name": "a",
      "dependencies": {
        "@tailor-platform/sdk": "2.4.0",
      },
    },
  },
  "packages": {
    "@tailor-platform/sdk": ["@tailor-platform/sdk@2.5.0", "", { "dependencies": { "zod": "^4.0.0" } }, "sha512-x"],

    "@tailor-platform/sdk-plugin-setup": ["@tailor-platform/sdk-plugin-setup@9.9.9", "", {}, "sha512-y"],

    "a/@tailor-platform/sdk": ["@tailor-platform/sdk@2.4.0", "", {}, "sha512-z"],
  }
}
`;
  const NPM_LOCK = JSON.stringify({
    name: "root",
    lockfileVersion: 3,
    packages: {
      "": { name: "root" },
      "apps/a": { name: "a" },
      "node_modules/@tailor-platform/sdk": { version: "2.5.0" },
      "node_modules/@tailor-platform/sdk-plugin-setup": { version: "9.9.9" },
      "apps/a/node_modules/@tailor-platform/sdk": { version: "2.4.0" },
    },
  });
  const PNPM_ENV_DOCUMENT = [
    "---",
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    configDependencies: {}",
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.16.1",
    "        version: 12.16.1",
    "",
    "packages:",
    "",
    "  pnpm@12.16.1:",
    "    resolution: {integrity: sha512-p}",
    "",
    "---",
  ].join("\n");
  const TWO_APPS = { ".": "3.0.0", "apps/a": "3.0.0" };

  test.each([
    ["pnpm-lock.yaml", ROOT_PNPM_LOCK, ["."], { ".": "2.5.0" }],
    ["pnpm-lock.yaml", `${PNPM_ENV_DOCUMENT}\n${ROOT_PNPM_LOCK}`, ["."], { ".": "2.5.0" }],
    [
      "pnpm-lock.yaml",
      pnpmLock(`${pnpmImporter(".", "2.5.0")}\n${pnpmImporter("apps/a", "2.4.0")}\n  apps/b: {}\n`),
      ["apps/a", "apps/b"],
      { "apps/a": "2.4.0", "apps/b": "2.5.0" },
    ],
    ["package-lock.json", NPM_LOCK, ["apps/a", "apps/b"], { "apps/a": "2.4.0", "apps/b": "2.5.0" }],
    ["yarn.lock", classicLock("2.5.0"), ["."], { ".": "2.5.0" }],
    ["yarn.lock", BERRY_LOCK, ["."], { ".": "2.5.0" }],
    ["bun.lock", BUN_LOCK, ["apps/a", "apps/b"], { "apps/a": "2.4.0", "apps/b": "2.5.0" }],
  ])(
    "%s: upgrades each app from the version the base branch resolves",
    (lockfile, baseLock, dirs, from) => {
      using tmp = tempDir("codemod-step-");
      const { result, calls, summary } = runCodemodStep(tmp.dir, {
        lockfile,
        baseLock,
        dirs,
        installed: TWO_APPS,
      });
      expect(result.failure).toBeUndefined();
      expect(summary).toContain("No codemod applies.");
      expect(calls).toEqual(
        Object.entries(from).map(([dir, version]) => [
          dir,
          `exec tailor upgrade --from ${version} --json --dry-run`,
        ]),
      );
    },
  );

  test("runs no codemod when the pull request keeps the SDK version", () => {
    using tmp = tempDir("codemod-step-");
    const { result, calls, annotations } = runCodemodStep(tmp.dir, { installed: { ".": "2.5.0" } });
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([]);
    expect(annotations).toEqual([]);
  });

  test("yarn: skips an app whose versions all stay, though the lockfile has several", () => {
    using tmp = tempDir("codemod-step-");
    const lock = classicLock("2.4.0", "2.5.0");
    const { result, calls } = runCodemodStep(tmp.dir, {
      lockfile: "yarn.lock",
      baseLock: lock,
      headLock: lock,
      installed: { ".": "2.5.0" },
    });
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("yarn: fails when the base branch has several versions and the pull request changes them", () => {
    using tmp = tempDir("codemod-step-");
    const { result, calls } = runCodemodStep(tmp.dir, {
      lockfile: "yarn.lock",
      baseLock: classicLock("2.4.0", "2.5.0"),
      headLock: classicLock("2.4.0", "3.0.0"),
    });
    expect(result.failure).toContain(
      "::error::yarn.lock of the base branch has @tailor-platform/sdk 2.4.0, 2.5.0",
    );
    expect(calls).toEqual([]);
  });

  test.each([
    ["has no lockfile", null],
    [
      "has no SDK",
      "lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      zod:\n        specifier: ^4.0.0\n        version: 4.0.0\n",
    ],
  ])("notes that no codemod runs when the base branch %s", (_case, baseLock) => {
    using tmp = tempDir("codemod-step-");
    const { result, calls, annotations } = runCodemodStep(tmp.dir, {
      baseLock,
      headLock: ROOT_PNPM_LOCK,
    });
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([]);
    expect(annotations).toEqual([
      "::notice::The base branch has no @tailor-platform/sdk for the root app, so no codemod runs there.",
    ]);
  });

  test("notes the app the pull request adds the SDK to, and upgrades the others", () => {
    using tmp = tempDir("codemod-step-");
    const noSdk =
      "  apps/b:\n    dependencies:\n      zod:\n        specifier: ^4.0.0\n        version: 4.0.0\n";
    const { result, calls, annotations } = runCodemodStep(tmp.dir, {
      dirs: ["apps/a", "apps/b"],
      installed: { "apps/a": "3.0.0", "apps/b": "3.0.0" },
      baseLock: pnpmLock(`${pnpmImporter("apps/a", "2.4.0")}\n${noSdk}`),
      headLock: pnpmLock(`${pnpmImporter("apps/a", "3.0.0")}\n${pnpmImporter("apps/b", "3.0.0")}`),
    });
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([["apps/a", "exec tailor upgrade --from 2.4.0 --json --dry-run"]]);
    expect(annotations).toEqual([
      "::notice::The base branch has no @tailor-platform/sdk for apps/b, so no codemod runs there.",
    ]);
  });

  test("runs no codemod when the base branch resolves the SDK the same way, such as to a link", () => {
    using tmp = tempDir("codemod-step-");
    const link = pnpmLock(
      "  .:\n    dependencies:\n      '@tailor-platform/sdk':\n        specifier: link:../sdk\n        version: link:../sdk\n",
    );
    const { result, calls } = runCodemodStep(tmp.dir, { baseLock: link, headLock: link });
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("fails when it cannot read the SDK version from the pull request's lockfile either", () => {
    using tmp = tempDir("codemod-step-");
    const { result, calls } = runCodemodStep(tmp.dir, {
      baseLock: pnpmLock(""),
      headLock: pnpmLock(""),
    });
    expect(result.failure).toContain(
      "::error::pnpm-lock.yaml does not list a version of @tailor-platform/sdk for the root app.",
    );
    expect(calls).toEqual([]);
  });

  test.each([
    [
      "resolves the SDK to a link",
      pnpmLock(
        "  .:\n    dependencies:\n      '@tailor-platform/sdk':\n        specifier: link:../sdk\n        version: link:../sdk\n",
      ),
      "::error::The base branch has @tailor-platform/sdk link:../sdk for the root app, which tailor upgrade cannot start from.",
    ],
    [
      "has a lockfile the step cannot parse",
      "{",
      "::error::Could not read package-lock.json of the base branch: ",
    ],
  ])("fails when the base branch %s", (_case, baseLock, message) => {
    using tmp = tempDir("codemod-step-");
    const { result, calls } = runCodemodStep(tmp.dir, {
      baseLock,
      ...(baseLock === "{"
        ? { lockfile: "package-lock.json", headLock: NPM_LOCK }
        : { headLock: ROOT_PNPM_LOCK }),
    });
    expect(result.failure).toContain(message);
    expect(calls).toEqual([]);
  });

  test("fails when the SDK is not installed for an app", () => {
    using tmp = tempDir("codemod-step-");
    const { result } = runCodemodStep(tmp.dir, { installed: {} });
    expect(result.failure).toContain(
      "::error::@tailor-platform/sdk is not installed for the root app.",
    );
  });

  const FILE_REVIEW = {
    codemodId: "v3/rename",
    prompt: "Rename `a` to `b`.\n",
    files: ["src/a.ts", "src/b.ts"],
    findings: [{ file: "src/a.ts", line: 3, message: "Uses a.", excerpt: "a()" }],
  };
  const PROJECT_REVIEW = { codemodId: "v3/manual", prompt: "Check the project.", files: [] };
  const LEGACY_WARNING =
    "src/c.ts: contains c but was not migrated automatically (rule: v3/c). Manual migration may be needed.";
  const APP_A = {
    dirs: ["apps/a"],
    installed: { "apps/a": "3.0.0" },
    baseLock: pnpmLock(pnpmImporter("apps/a", "2.5.0")),
  };

  test("warn: annotates what tailor upgrade would change as warnings, relative to the repository root", () => {
    using tmp = tempDir("codemod-step-");
    const { result, calls, annotations, summary } = runCodemodStep(tmp.dir, {
      ...APP_A,
      codemod: "warn",
      upgrade: {
        stdout: (checkout) =>
          upgradeStdout({
            filesModified: [path.join(checkout, "apps/a/src/x.ts")],
            llmReviews: [FILE_REVIEW, PROJECT_REVIEW],
            warnings: [LEGACY_WARNING],
          }),
      },
    });
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([["apps/a", "exec tailor upgrade --from 2.5.0 --json --dry-run"]]);
    expect(annotations).toEqual([
      "::warning::@tailor-platform/sdk 2.5.0 → 3.0.0 in apps/a: 1 file(s) for tailor upgrade --from 2.5.0 to rewrite and 2 codemod(s) to review. The job summary lists them.",
      "::warning file=apps/a/src/x.ts,title=Codemod not applied::tailor upgrade --from 2.5.0 rewrites this file.",
      "::warning file=apps/a/src/a.ts,line=3,title=Review needed%3A v3/rename::Uses a.",
      "::warning file=apps/a/src/b.ts,title=Review needed%3A v3/rename::The v3/rename codemod could not migrate this file on its own.",
      "::warning title=Review needed%3A v3/manual::Review apps/a for the v3/manual migration.",
      `::warning::apps/a/${LEGACY_WARNING}`,
    ]);
    expect(summary).toContain("### @tailor-platform/sdk 2.5.0 → 3.0.0 in apps/a\n");
    expect(summary).toContain("- `apps/a/src/x.ts`\n");
    expect(summary).toContain(
      "- `apps/a/src/a.ts`\n  - line 3: Uses a. `a()`\n- `apps/a/src/b.ts`\n",
    );
    expect(summary).toContain("```text\nRename `a` to `b`.\n```");
    expect(summary).toContain("- All of apps/a\n");
  });

  test.each<[string, UpgradeResult]>([
    ["files to rewrite", { filesModified: ["src/x.ts"] }],
    ["only a review of the whole app", { llmReviews: [PROJECT_REVIEW] }],
  ])("error: reports %s as errors, for the last step to fail on", (_case, found) => {
    using tmp = tempDir("codemod-step-");
    const { result, annotations } = runCodemodStep(tmp.dir, {
      codemod: "error",
      upgrade: {
        stdout: (checkout) =>
          upgradeStdout({
            ...found,
            filesModified: (found.filesModified ?? []).map((file) => path.join(checkout, file)),
          }),
      },
    });
    expect(result.failure).toBeUndefined();
    expect(result.outputs["tailor-codemod"]).toEqual({ pending: "true" });
    expect(annotations.length).toBeGreaterThan(1);
    expect(annotations.every((line) => line.startsWith("::error"))).toBe(true);
  });

  test("error: passes with legacy-pattern warnings only, leaving them as warnings", () => {
    using tmp = tempDir("codemod-step-");
    const { result, annotations } = runCodemodStep(tmp.dir, {
      codemod: "error",
      upgrade: { stdout: upgradeStdout({ warnings: [LEGACY_WARNING] }) },
    });
    expect(result.failure).toBeUndefined();
    expect(result.outputs["tailor-codemod"]).toEqual({});
    expect(annotations).toEqual([`::warning::${LEGACY_WARNING}`]);
  });

  test("error: reports every app", () => {
    using tmp = tempDir("codemod-step-");
    const { result, calls, annotations } = runCodemodStep(tmp.dir, {
      codemod: "error",
      dirs: ["apps/a", "apps/b"],
      installed: { ".": "3.0.0" },
      upgrade: { stdout: upgradeStdout({ llmReviews: [PROJECT_REVIEW] }) },
    });
    expect(result.outputs["tailor-codemod"]).toEqual({ pending: "true" });
    expect(calls.map(([dir]) => dir)).toEqual(["apps/a", "apps/b"]);
    expect(annotations).toContain(
      "::error::@tailor-platform/sdk 2.5.0 → 3.0.0 in apps/b: 1 codemod(s) to review. The job summary lists them.",
    );
  });

  test("deterministic: leaves the rewrites to commit, except workflow files the commit cannot change", () => {
    using tmp = tempDir("codemod-step-");
    const { result, calls, annotations, summary, checkout } = runCodemodStep(tmp.dir, {
      codemod: "deterministic",
      files: { "src/x.ts": "old\n", ".github/workflows/ci.yml": "name: ci\n" },
      upgrade: {
        script: "echo new > src/x.ts\necho 'name: rewritten' > .github/workflows/ci.yml\n",
        stdout: (root) =>
          upgradeStdout({
            filesModified: [
              path.join(root, "src/x.ts"),
              path.join(root, ".github/workflows/ci.yml"),
            ],
            llmReviews: [FILE_REVIEW],
          }),
      },
    });
    expect(result.failure).toBeUndefined();
    expect(calls).toEqual([[".", "exec tailor upgrade --from 2.5.0 --json"]]);
    expect(fs.readFileSync(path.join(checkout, "src/x.ts"), "utf-8")).toBe("new\n");
    expect(fs.readFileSync(path.join(checkout, ".github/workflows/ci.yml"), "utf-8")).toBe(
      "name: ci\n",
    );
    expect(annotations).toEqual([
      "::warning::@tailor-platform/sdk 2.5.0 → 3.0.0 in the root app: 1 file(s) for tailor upgrade --from 2.5.0 to rewrite and 1 codemod(s) to review. The job summary lists them.",
      "::warning file=.github/workflows/ci.yml,title=Codemod not applied::tailor upgrade --from 2.5.0 rewrites this workflow file, which the fix commit cannot change. Run it and commit the file yourself.",
      "::warning file=src/a.ts,line=3,title=Review needed%3A v3/rename::Uses a.",
      "::warning file=src/b.ts,title=Review needed%3A v3/rename::The v3/rename codemod could not migrate this file on its own.",
    ]);
    expect(summary).toContain("`tailor upgrade --from 2.5.0` rewrote:\n\n- `src/x.ts`\n");
  });

  test("deterministic: adds no annotation when every rewrite is committed", () => {
    using tmp = tempDir("codemod-step-");
    const { result, annotations } = runCodemodStep(tmp.dir, {
      codemod: "deterministic",
      upgrade: {
        stdout: (root) => upgradeStdout({ filesModified: [path.join(root, "src/x.ts")] }),
      },
    });
    expect(result.failure).toBeUndefined();
    expect(annotations).toEqual([]);
  });

  test("reads the result past what the package manager prints around it", () => {
    using tmp = tempDir("codemod-step-");
    const { result, annotations } = runCodemodStep(tmp.dir, {
      upgrade: {
        stdout: `yarn run v1.22.22\n$ tailor upgrade\n${upgradeStdout({ warnings: [LEGACY_WARNING] })}Done in 1.00s.\n`,
      },
    });
    expect(result.failure).toBeUndefined();
    expect(annotations).toEqual([`::warning::${LEGACY_WARNING}`]);
  });

  test.each([
    ["exits with an error", { stdout: upgradeStdout(), status: 1 }, "failed for the root app"],
    [
      "prints no llmReviews",
      { stdout: `${JSON.stringify({ filesModified: [], warnings: [] })}\n` },
      "printed no result for the root app",
    ],
  ])("fails when tailor upgrade %s", (_case, upgrade, message) => {
    using tmp = tempDir("codemod-step-");
    const { result } = runCodemodStep(tmp.dir, { codemod: "warn", upgrade });
    expect(result.failure).toContain(`::error::tailor upgrade --from 2.5.0 ${message}.`);
  });

  test("escapes what it puts in an annotation", () => {
    using tmp = tempDir("codemod-step-");
    const { annotations } = runCodemodStep(tmp.dir, {
      upgrade: {
        stdout: (root) =>
          upgradeStdout({
            filesModified: [path.join(root, "src/a,b:100%.ts")],
            warnings: ["line 1\nline 2: 100%\r"],
          }),
      },
    });
    expect(annotations).toContain(
      "::warning file=src/a%2Cb%3A100%25.ts,title=Codemod not applied::tailor upgrade --from 2.5.0 rewrites this file.",
    );
    expect(annotations).toContain("::warning::line 1%0Aline 2: 100%25%0D");
  });

  test("keeps backticks in the excerpt and prompt from closing the summary's code", () => {
    using tmp = tempDir("codemod-step-");
    const { summary } = runCodemodStep(tmp.dir, {
      upgrade: {
        stdout: upgradeStdout({
          llmReviews: [
            {
              ...FILE_REVIEW,
              prompt: "Before:\n```ts\na()\n```",
              findings: [{ ...FILE_REVIEW.findings[0], excerpt: "`a` + ``b``" }],
            },
          ],
        }),
      },
    });
    expect(summary).toContain("line 3: Uses a. ``` `a` + ``b`` ```\n");
    expect(summary).toContain("````text\nBefore:\n```ts\na()\n```\n````\n");
  });
});

describe("setupAutofix", () => {
  let repo: string;
  aroundEach(async (runTest) => {
    using tmp = tempDir("setup-autofix-");
    repo = tmp.dir;
    fs.writeFileSync(path.join(repo, "pnpm-lock.yaml"), "");
    fs.writeFileSync(path.join(repo, "tailor.config.ts"), "export default {};\n");
    await runTest();
  });

  const workflowFile = () => path.join(repo, AUTOFIX_WORKFLOW_FILE);
  const options = (overrides: Partial<AutofixSetupOptions> = {}) =>
    autofixSetupOptions(repo, overrides);
  const deployTarget = (workspaceName: string, file: string): LockTarget => ({
    kind: "branch",
    workspaceName,
    file,
    templateVersion: TEMPLATE_VERSION,
    inputs: {
      branch: "main",
      tagPattern: null,
      environment: workspaceName,
      dir: ".",
      packageManager: "pnpm",
    },
    generatedIds: [],
    contentHash: "managed-v1:sha256:0",
  });
  const appDir = (dir: string) => {
    fs.mkdirSync(path.join(repo, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, dir, "tailor.config.ts"), "export default {};\n");
  };

  test("writes the workflow and records it in the lock next to the deploy targets", async () => {
    const target = deployTarget("my-app", ".github/workflows/tailor-my-app.yml");
    writeLock(repo, { version: LOCK_VERSION, targets: [target] });

    await setupAutofix(options());

    const content = fs.readFileSync(workflowFile(), "utf-8");
    const lock = readLock(repo);
    expect(lock?.targets).toEqual([target]);
    expect(lock?.autofix).toEqual({
      file: AUTOFIX_WORKFLOW_FILE,
      templateVersion: TEMPLATE_VERSION,
      inputs: {
        provider: "github-token",
        dirs: ["."],
        packageManager: "pnpm",
        packageManagerAutoDetected: true,
      },
      generatedIds: render("github-token").generatedIds,
      contentHash: computeManagedHash(content, render("github-token").generatedIds),
      managedHashes: expect.any(Object),
    });
    expect(content).toBe(render("github-token").content);
  });

  test("records an explicit package manager and the securefix server repository", async () => {
    await setupAutofix(
      options({
        provider: "securefix",
        securefixServerRepository: "securefix-server",
        packageManager: "yarn",
      }),
    );

    expect(readLock(repo)?.autofix?.inputs).toEqual({
      provider: "securefix",
      dirs: ["."],
      packageManager: "yarn",
      packageManagerAutoDetected: false,
      securefixServerRepository: "securefix-server",
    });
    expect(fs.readFileSync(workflowFile(), "utf-8")).toContain(
      "server_repository: securefix-server",
    );
  });

  test("records --codemod in the lock and renders its steps", async () => {
    await setupAutofix(options({ codemod: "deterministic" }));

    expect(readLock(repo)?.autofix?.inputs.codemod).toBe("deterministic");
    expect(fs.readFileSync(workflowFile(), "utf-8")).toBe(
      render("github-token", { codemod: "deterministic" }).content,
    );
  });

  test("rejects --codemod for a bun repository with only the binary bun.lockb", async () => {
    fs.writeFileSync(path.join(repo, "bun.lockb"), "");
    const bun = { codemod: "warn", packageManager: "bun" } as const;

    await expect(setupAutofix(options(bun))).rejects.toThrow(
      /--codemod reads the SDK version of the base branch from bun\.lock/,
    );
    expect(fs.existsSync(path.join(repo, ".github"))).toBe(false);

    await setupAutofix(options({ ...bun, codemod: "off" }));
    fs.writeFileSync(path.join(repo, "bun.lock"), "{}");
    await setupAutofix(options(bun));
    expect(readLock(repo)?.autofix?.inputs.codemod).toBe("warn");
  });

  test.each([
    [{ provider: "securefix" }, /--provider securefix requires --securefix-server-repository/],
    [
      { provider: "securefix", securefixServerRepository: "acme/server" },
      /Invalid --securefix-server-repository "acme\/server"/,
    ],
    [
      { provider: "securefix", securefixServerRepository: ".." },
      /Invalid --securefix-server-repository ".."/,
    ],
    [
      { provider: "github-app", securefixServerRepository: "securefix-server" },
      /--securefix-server-repository is only used with --provider securefix/,
    ],
  ] as const)("rejects %o before writing anything", async (overrides, message) => {
    await expect(setupAutofix(options(overrides))).rejects.toThrow(message);
    expect(fs.existsSync(path.join(repo, ".github"))).toBe(false);
  });

  test("refuses the file a deploy target named autofix already generated", async () => {
    writeLock(repo, {
      version: LOCK_VERSION,
      targets: [deployTarget("autofix", AUTOFIX_WORKFLOW_FILE)],
    });
    fs.mkdirSync(path.dirname(workflowFile()), { recursive: true });
    fs.writeFileSync(workflowFile(), "name: deploy\n");

    await expect(setupAutofix(options({ force: true }))).rejects.toThrow(
      /branch target "autofix" already owns \.github\/workflows\/tailor-autofix\.yml/,
    );
    expect(fs.readFileSync(workflowFile(), "utf-8")).toBe("name: deploy\n");
    expect(readLock(repo)?.autofix).toBeUndefined();
  });

  test("keeps the user's own steps and jobs when the provider changes", async () => {
    await setupAutofix(options());
    const edited = fs
      .readFileSync(workflowFile(), "utf-8")
      .replace(
        "      - id: tailor-autofix-baseline\n",
        "      - id: registry-auth\n        run: echo auth\n      - id: tailor-autofix-baseline\n",
      )
      .concat("  notify:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo done\n");
    fs.writeFileSync(workflowFile(), edited);

    await setupAutofix(options({ provider: "github-app" }));

    const workflow = parseYAML(fs.readFileSync(workflowFile(), "utf-8")) as Workflow;
    expect(workflow.jobs["tailor-autofix"]?.steps.map((step) => step.id)).toContain(
      "registry-auth",
    );
    expect(workflow.jobs.notify).toBeDefined();
    expect(stepOf(workflow, "tailor-autofix-push", "tailor-app-token")).toBeDefined();
    expect(readLock(repo)?.autofix?.inputs.provider).toBe("github-app");
  });

  test("asks for --force to reset a hand edit to a managed step", async () => {
    await setupAutofix(options());
    const generated = fs.readFileSync(workflowFile(), "utf-8");
    fs.writeFileSync(workflowFile(), generated.replace("git reset -q\n", "git reset\n"));

    await expect(setupAutofix(options())).rejects.toThrow(/--force/);
    await setupAutofix(options({ force: true }));
    expect(fs.readFileSync(workflowFile(), "utf-8")).toContain("git reset -q\n");
  });

  test("runs tailor generate in each app directory, with no --name or root SDK dependency", async () => {
    appDir("apps/erp");
    appDir("apps/users");

    await setupAutofix(options({ dir: ["apps/erp", "./apps/users/"] }));

    expect(readLock(repo)?.autofix?.inputs.dirs).toEqual(["apps/erp", "apps/users"]);
    const workflow = parseYAML(fs.readFileSync(workflowFile(), "utf-8")) as Workflow;
    expect(
      stepOf(workflow, "tailor-autofix", "tailor-generate-apps-users")["working-directory"],
    ).toBe("apps/users");
  });

  test("rejects a directory given twice", async () => {
    appDir("apps/erp");
    await expect(setupAutofix(options({ dir: ["apps/erp", "apps/erp/"] }))).rejects.toThrow(
      /--dir "apps\/erp" and "apps\/erp"/,
    );
  });

  test("rejects a directory without tailor.config.ts", async () => {
    fs.mkdirSync(path.join(repo, "apps/web"), { recursive: true });
    await expect(setupAutofix(options({ dir: "apps/web" }))).rejects.toThrow(/--dir/);
    expect(fs.existsSync(path.join(repo, ".github"))).toBe(false);
  });
});

describe("printAutofixNextSteps", () => {
  const output = (provider: AutofixProvider) => {
    using log = vi.spyOn(logger, "log").mockImplementation(() => {});
    using _info = vi.spyOn(logger, "info").mockImplementation(() => {});
    printAutofixNextSteps({ provider });
    return log.mock.calls.map(([line]) => line).join("\n");
  };

  test("github-token: says the checks of each fix commit wait for approval", () => {
    expect(output("github-token")).toContain('"Approve\n   workflows to run"');
    expect(output("github-token")).not.toContain("tailor setup ci env");
  });

  test.each(["github-app", "securefix"] as const)(
    "%s: points to `tailor setup ci env` for the App's client ID and private key",
    (provider) => {
      expect(output(provider)).toMatch(
        /tailor setup ci env +#[\s\S]*--format terraform[\s\S]*tailor setup ci env --check/,
      );
    },
  );

  test("autofix-ci: links the GitHub App to install", () => {
    expect(output("autofix-ci")).toContain("https://github.com/apps/autofix-ci");
  });

  test.each(AUTOFIX_PROVIDERS)("%s: lists the files to commit", (provider) => {
    expect(output(provider)).toContain(`   - ${AUTOFIX_WORKFLOW_FILE}\n   - .github/tailor.lock`);
  });
});
