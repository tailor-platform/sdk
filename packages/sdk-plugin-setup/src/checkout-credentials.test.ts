import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { renderBranchWorkflow, renderPreviewWorkflow, renderTagWorkflow } from "./templates";

type Step = { id?: string; uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

const COMMON = { workspaceName: "my-app", environment: "my-app", packageManager: "pnpm" as const };
const workflows: [string, string][] = [
  ["branch", renderBranchWorkflow({ ...COMMON, branch: "main", erdPreview: null }).content],
  [
    "branch with ERD preview",
    renderBranchWorkflow({ ...COMMON, branch: "main", erdPreview: { namespaces: ["tailordb"] } })
      .content,
  ],
  [
    "tag with branch guard",
    renderTagWorkflow({ ...COMMON, tagPattern: "v*", branch: "main" }).content,
  ],
  ["preview", renderPreviewWorkflow({ ...COMMON, branch: "main", region: "us-west" }).content],
];

function steps(content: string, uses: string): { job: string; step: Step }[] {
  const workflow = parse(content) as Workflow;
  return Object.entries(workflow.jobs).flatMap(([job, { steps = [] }]) =>
    steps.filter((step) => step.uses?.startsWith(uses)).map((step) => ({ job, step })),
  );
}

describe("generated workflows keep the GitHub token out of .git/config", () => {
  test.each(workflows)(
    "every checkout in the %s workflow sets persist-credentials: false",
    (_, content) => {
      const checkouts = steps(content, "actions/checkout@");
      expect(checkouts.length).toBeGreaterThan(0);
      for (const { job, step } of checkouts) {
        expect(step.with?.["persist-credentials"], `${job}/${step.id}`).toBe(false);
      }
    },
  );

  test.each(workflows.filter(([name]) => name.includes("tag")))(
    "the tag guard in the %s workflow fetches the target branch with the job token",
    (_, content) => {
      const guards = steps(content, "tailor-platform/actions/tag-guard@");
      expect(guards.length).toBeGreaterThan(0);
      for (const { step } of guards) {
        expect(step.with?.["github-token"]).toBe("${{ github.token }}");
      }
    },
  );
});
