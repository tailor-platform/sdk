// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
import { createWorkflow, createWorkflowJob } from "#/configure/services/workflow/index";
import { type ListWorkflowExecutionsTypedOptions } from "./executions";

const mainJob = createWorkflowJob({
  name: "main",
  body: () => ({ ok: true as const }),
});

const myWorkflow = createWorkflow({
  name: "my-workflow",
  mainJob,
});

describe("listWorkflowExecutions API types", () => {
  test("accepts typed options with workflow definition", () => {
    const acceptsOptions = (
      _options: ListWorkflowExecutionsTypedOptions<typeof myWorkflow>,
    ): void => {};

    acceptsOptions({
      workflow: myWorkflow,
    });

    acceptsOptions({
      workflow: myWorkflow,
      status: "RUNNING",
      order: "desc",
      limit: 25,
      workspaceId: "ws-1",
      profile: "dev",
    });
  });

  test("rejects invalid order values", () => {
    const acceptsOptions = (_options: ListWorkflowExecutionsTypedOptions): void => {};

    acceptsOptions({
      // @ts-expect-error - only "asc" and "desc" are valid
      order: "newest",
    });
  });

  test("allows omitting workflow for unfiltered listing", () => {
    const acceptsOptions = (
      _options: ListWorkflowExecutionsTypedOptions<typeof myWorkflow>,
    ): void => {};

    acceptsOptions({});

    acceptsOptions({
      status: "SUCCESS",
    });
  });

  test("works with default generic when ListWorkflowExecutionsTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: ListWorkflowExecutionsTypedOptions): void => {};

    acceptsDefaultOptions({
      workflow: myWorkflow,
    });

    acceptsDefaultOptions({
      workflow: { name: "any-workflow" },
    });

    acceptsDefaultOptions({});
  });

  test("rejects legacy options shape in typed overload", () => {
    const acceptsTypedOptions = (_options: ListWorkflowExecutionsTypedOptions): void => {};

    acceptsTypedOptions({
      // @ts-expect-error - typed overload requires workflow, not workflowName
      workflowName: "legacy-workflow",
    });
  });
});
