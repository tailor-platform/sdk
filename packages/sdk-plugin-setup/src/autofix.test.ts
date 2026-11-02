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
  AUTOFIX_PROVIDERS,
  AUTOFIX_WORKFLOW_FILE,
  TEMPLATE_VERSION,
  type AutofixProvider,
} from "./templates";
import { renderAutofixFor } from "./test-helpers/autofix";
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

describe("renderAutofixWorkflow", () => {
  test.each(AUTOFIX_PROVIDERS)("%s: leaves no template markers", (provider) => {
    const { content } = render(provider, { dirs: ["apps/a", "apps/b"] });
    expect(content).not.toMatch(/__[A-Z_]+__/);
  });

  test.each(AUTOFIX_PROVIDERS)(
    "%s: lists exactly the jobs and steps it generates as managed",
    (provider) => {
      for (const dirs of [["."], ["apps/a", "apps/b"]]) {
        const { content, generatedIds } = render(provider, { dirs });
        const workflow = parseYAML(content) as Workflow;
        const ids = Object.entries(workflow.jobs).flatMap(([job, { steps }]) => [
          job,
          ...steps.map((step) => `${job}/${String(step.id)}`),
        ]);
        expect(generatedIds.toSorted()).toEqual(ids.toSorted());
      }
    },
  );

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
 * @returns The outputs of every step so far, and the output of the step that failed, if any
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
}): { outputs: StepOutputs; failure?: string } {
  const outputs: StepOutputs = { ...obj.outputs };
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
    if (result.status !== 0) return { outputs, failure: `${result.stdout}${result.stderr}` };
  }
  return { outputs };
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
  const bin = path.join(root, "bin");
  const runnerTemp = path.join(root, "push-temp");
  const checkout = path.join(root, "push-checkout");
  fs.mkdirSync(bin);
  fs.mkdirSync(runnerTemp);
  fs.writeFileSync(path.join(bin, "gh"), FAKE_GH, { mode: 0o755 });
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
      PATH: `${bin}:${process.env.PATH ?? ""}`,
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
  const options = (overrides: Partial<AutofixSetupOptions> = {}): AutofixSetupOptions => ({
    provider: "github-token",
    dir: ".",
    force: false,
    outputDir: repo,
    ...overrides,
  });
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
