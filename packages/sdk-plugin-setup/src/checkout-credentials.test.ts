import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { renderedTemplates } from "./template-fingerprint";

type Step = { id?: string; uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };

function steps(content: string, uses: string): { job: string; step: Step }[] {
  const workflow = parse(content) as Workflow;
  return Object.entries(workflow.jobs).flatMap(([job, { steps = [] }]) =>
    steps.filter((step) => step.uses?.startsWith(uses)).map((step) => ({ job, step })),
  );
}

const TAG_GUARD = "tailor-platform/actions/tag-guard@";
const templates = renderedTemplates();
const guarded = templates.filter(({ content }) => steps(content, TAG_GUARD).length > 0);

describe("generated workflows keep the GitHub token out of .git/config", () => {
  test.each(templates)(
    "every checkout in the $name workflow sets persist-credentials: false",
    ({ content }) => {
      const checkouts = steps(content, "actions/checkout@");
      expect(checkouts.length).toBeGreaterThan(0);
      for (const { job, step } of checkouts) {
        expect(step.with?.["persist-credentials"], `${job}/${step.id}`).toBe(false);
      }
    },
  );

  test("some rendered workflow has a tag guard", () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  test.each(guarded)(
    "the tag guard in the $name workflow fetches the target branch with the job token",
    ({ content }) => {
      for (const { step } of steps(content, TAG_GUARD)) {
        expect(step.with?.["github-token"]).toBe("${{ github.token }}");
      }
    },
  );
});
