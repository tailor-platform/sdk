import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { renderedTemplates } from "./template-fingerprint";
import { renderBranchWorkflow, type RenderResult } from "./templates";

type Step = {
  id?: string;
  if?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};
type Job = { environment?: string; steps: Step[] };

const ENV_CHECK = "tailor-env-check";

const renders = new Map(renderedTemplates().map((rendered) => [rendered.name, rendered]));

function jobsOf(content: string): Record<string, Job> {
  return (parse(content) as { jobs: Record<string, Job> }).jobs;
}

function render(name: string): RenderResult {
  const rendered = renders.get(name);
  if (!rendered) throw new Error(`no render named ${name}`);
  return rendered;
}

// What the job's other steps read, as `<name>: <contexts>`.
function readNames(job: Job): Record<string, string[]> {
  const read: Record<string, Set<string>> = {};
  const others = job.steps.filter((step) => step.id !== ENV_CHECK);
  for (const match of JSON.stringify(others).matchAll(
    /\b(vars|secrets)\.([A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    const [, context, name] = match as unknown as [string, string, string];
    if (name === "GITHUB_TOKEN") continue;
    (read[name] ??= new Set()).add(context);
  }
  return Object.fromEntries(
    Object.entries(read).map(([name, contexts]) => [name, [...contexts].toSorted().toReversed()]),
  );
}

function envCheckOf(content: string, job: string): Step | undefined {
  return jobsOf(content)[job]?.steps.find((step) => step.id === ENV_CHECK);
}

const lines = (value: string | undefined) => (value ?? "").split("\n").filter(Boolean);

function inputsOf(step: Step | undefined): Record<string, string | string[] | undefined> {
  const { required, optional, ...rest }: Record<string, string | undefined> = step?.with ?? {};
  return { required: lines(required), optional: lines(optional), ...rest };
}

const CLIENT_ID = "TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID";
const CLIENT_SECRET = "TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET";
const WORKSPACE_ID = "TAILOR_PLATFORM_WORKSPACE_ID";
const ORGANIZATION_ID = "TAILOR_PLATFORM_ORGANIZATION_ID";
const FOLDER_ID = "TAILOR_PLATFORM_FOLDER_ID";
const FAIL_ON_DRIFT = "TAILOR_PLATFORM_FAIL_ON_DRIFT";
const SLACK = ["TAILOR_SLACK_BOT_TOKEN", "TAILOR_SLACK_CHANNEL_ID"];
const SEED_USER_PASSWORD = "SEED_USER_PASSWORD";
const APP = ["TAILOR_AUTOFIX_APP_CLIENT_ID", "TAILOR_AUTOFIX_APP_PRIVATE_KEY"];

describe("tailor-env-check", () => {
  test.each([...renders.values()])(
    "$name checks exactly what each job reads",
    ({ content, generatedIds }) => {
      const jobs = Object.entries(jobsOf(content));
      const expected = jobs.map(([name, job]) => {
        const env = Object.fromEntries(
          Object.entries(readNames(job)).map(([entry, contexts]) => {
            const fallback = entry === ORGANIZATION_ID || entry === FOLDER_ID ? ["env"] : [];
            const operands = [...contexts, ...fallback].map((context) => `${context}.${entry}`);
            const value = operands.length === 1 ? operands[0] : `(${operands.join(" || ")})`;
            return [entry, `\${{ ${value} != '' }}`];
          }),
        );
        return { name, env, listed: Object.keys(env).length > 0 };
      });
      const actual = jobs.map(([name, job]) => ({
        name,
        env: job.steps.find((step) => step.id === ENV_CHECK)?.env ?? {},
        listed: generatedIds.includes(`${name}/${ENV_CHECK}`),
      }));
      expect(actual).toEqual(expected);
    },
  );

  test.each([...renders.values()].filter(({ template }) => template !== "autofix"))(
    "$name checks right after install, in the job's environment, with its package manager",
    ({ content }) => {
      const checks = Object.entries(jobsOf(content)).flatMap(([name, job]) => {
        const index = job.steps.findIndex((step) => step.id === ENV_CHECK);
        if (index === -1) return [];
        const install = job.steps.find((step) => step.id === "tailor-install");
        return [
          {
            actual: {
              name,
              after: job.steps[index - 1]?.id,
              environment: job.steps[index]!.with?.environment,
              packageManager: job.steps[index]!.with?.["package-manager"],
            },
            expected: {
              name,
              after: "tailor-install",
              environment: String(job.environment),
              packageManager: install?.with?.["package-manager"],
            },
          },
        ];
      });
      expect(checks.map(({ actual }) => actual)).toEqual(checks.map(({ expected }) => expected));
    },
  );

  test("the plan job only warns, and skips fork pull requests like the plan step", () => {
    const { content } = render("branch/pnpm");
    const plan = jobsOf(content)["tailor-plan"]!;
    const check = envCheckOf(content, "tailor-plan");
    expect(check?.if).toBe(plan.steps.find((step) => step.id === "tailor-plan")?.if);
    expect(check?.if).toContain("fork");
    expect(inputsOf(check)).toEqual({
      environment: "production",
      "package-manager": "pnpm",
      required: [CLIENT_ID, CLIENT_SECRET, WORKSPACE_ID],
      optional: [FAIL_ON_DRIFT],
      "fail-on-missing": "false",
    });
  });

  test("the deploy job fails on an empty required entry and lists the optional Slack ones", () => {
    const { content } = render("branch/npm");
    const check = envCheckOf(content, "tailor-deploy");
    expect(check?.if).toBeUndefined();
    expect(inputsOf(check)).toEqual({
      environment: "production",
      "package-manager": "npm",
      required: [CLIENT_ID, CLIENT_SECRET, WORKSPACE_ID],
      optional: SLACK,
    });
  });

  test("the seed password is optional where seeding reads it", () => {
    const { content } = render("branch/full");
    expect(inputsOf(envCheckOf(content, "tailor-plan")).optional).toEqual([
      FAIL_ON_DRIFT,
      SEED_USER_PASSWORD,
    ]);
    expect(inputsOf(envCheckOf(content, "tailor-deploy")).optional).toEqual([
      ...SLACK,
      SEED_USER_PASSWORD,
    ]);
  });

  test("the plan job of a split plan environment checks that environment", () => {
    expect(
      inputsOf(envCheckOf(render("branch/split-plan-environment").content, "tailor-plan"))
        .environment,
    ).toBe("production-plan");
  });

  test("the migration test checks the source workspace of its own environment", () => {
    expect(
      inputsOf(envCheckOf(render("branch/migration-test").content, "tailor-migration-test")),
    ).toEqual({
      environment: "production",
      "package-manager": "pnpm",
      required: [CLIENT_ID, CLIENT_SECRET, WORKSPACE_ID],
      optional: [],
    });
    expect(
      inputsOf(
        envCheckOf(render("branch/migration-test-dedicated").content, "tailor-migration-test"),
      ),
    ).toEqual({
      environment: "prod-source",
      "package-manager": "pnpm",
      required: [CLIENT_ID, CLIENT_SECRET, "TAILOR_PLATFORM_MIGRATION_TEST_SOURCE_WORKSPACE_ID"],
      optional: [],
    });
  });

  test("the tag workflow's plan job only warns", () => {
    const { content } = render("tag/pnpm");
    expect(envCheckOf(content, "tailor-plan")?.if).toBeUndefined();
    expect(inputsOf(envCheckOf(content, "tailor-plan"))["fail-on-missing"]).toBe("false");
    expect(inputsOf(envCheckOf(content, "tailor-deploy"))["fail-on-missing"]).toBeUndefined();
  });

  test("the preview deploy needs the organization, and cleanup only prunes with it", () => {
    expect(inputsOf(envCheckOf(render("preview/full").content, "tailor-preview-deploy"))).toEqual({
      environment: "production",
      "package-manager": "pnpm",
      required: [CLIENT_ID, CLIENT_SECRET, ORGANIZATION_ID],
      optional: [FOLDER_ID, FAIL_ON_DRIFT, SEED_USER_PASSWORD],
    });
    expect(
      inputsOf(envCheckOf(render("preview-cleanup/pnpm").content, "tailor-preview-cleanup")),
    ).toEqual({
      environment: "production",
      "package-manager": "pnpm",
      required: [CLIENT_ID, CLIENT_SECRET],
      optional: [ORGANIZATION_ID, FOLDER_ID],
    });
  });

  test("keeps an environment name YAML would read as another type a string", () => {
    const { content } = renderBranchWorkflow({
      workspaceName: "my-app",
      environment: "1.0",
      packageManager: "pnpm",
      branch: "main",
      erdPreview: null,
    });
    expect(inputsOf(envCheckOf(content, "tailor-deploy")).environment).toBe("1.0");
  });

  describe("autofix", () => {
    test("checks the securefix App only when the job commits", () => {
      const { content } = render("autofix/securefix");
      const job = jobsOf(content)["tailor-autofix"]!;
      const ids = job.steps.map((step) => step.id);
      const check = envCheckOf(content, "tailor-autofix");
      expect(ids.indexOf(ENV_CHECK)).toBe(ids.indexOf("tailor-securefix") - 1);
      expect(check?.if).toBe(job.steps.find((step) => step.id === "tailor-securefix")?.if);
      expect(check?.if).toBeDefined();
      expect(inputsOf(check)).toEqual({ required: APP, optional: [] });
    });

    test.each(["autofix/github-app", "autofix/securefix-claude"])(
      "%s checks the App first in the push job",
      (name) => {
        const { content } = render(name);
        const check = envCheckOf(content, "tailor-autofix-push");
        expect(jobsOf(content)["tailor-autofix-push"]!.steps[0]?.id).toBe(ENV_CHECK);
        expect(check?.if).toBeUndefined();
        expect(inputsOf(check)).toEqual({ required: APP, optional: [] });
      },
    );

    test("only warns about the agent's API key, so the push job still commits the codemods' changes", () => {
      const { content } = render("autofix/securefix-claude");
      const check = envCheckOf(content, "tailor-codemod-agent");
      expect(jobsOf(content)["tailor-codemod-agent"]!.steps[0]?.id).toBe(ENV_CHECK);
      expect(inputsOf(check)).toEqual({
        required: ["TAILOR_AUTOFIX_ANTHROPIC_API_KEY"],
        optional: ["TAILOR_AUTOFIX_CLAUDE_MODEL"],
        "fail-on-missing": "false",
      });
      expect(envCheckOf(content, "tailor-autofix")).toBeUndefined();
    });

    test("adds no check where the workflow reads no secret or variable", () => {
      const { content, generatedIds } = render("autofix/github-token");
      expect(content).not.toContain(ENV_CHECK);
      expect(generatedIds.filter((id) => id.endsWith(ENV_CHECK))).toEqual([]);
    });
  });
});
