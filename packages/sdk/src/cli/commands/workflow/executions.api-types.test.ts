import { describe, it } from "vitest";
import { createWorkflow, createWorkflowJob } from "@/configure/services/workflow";
import {
  type ListWorkflowExecutionsOptions,
  type ListWorkflowExecutionsTypedOptions,
} from "./executions";

const mainJob = createWorkflowJob({
  name: "main",
  body: () => ({ ok: true as const }),
});

const myWorkflow = createWorkflow({
  name: "my-workflow",
  mainJob,
});

describe("listWorkflowExecutions API types", () => {
  it("accepts typed options with workflow definition", () => {
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

  it("rejects invalid order values", () => {
    const acceptsOptions = (_options: ListWorkflowExecutionsTypedOptions): void => {};

    acceptsOptions({
      // @ts-expect-error - only "asc" and "desc" are valid
      order: "newest",
    });
  });

  it("allows omitting workflow for unfiltered listing", () => {
    const acceptsOptions = (
      _options: ListWorkflowExecutionsTypedOptions<typeof myWorkflow>,
    ): void => {};

    acceptsOptions({});

    acceptsOptions({
      status: "SUCCESS",
    });
  });

  it("works with default generic when ListWorkflowExecutionsTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: ListWorkflowExecutionsTypedOptions): void => {};

    acceptsDefaultOptions({
      workflow: myWorkflow,
    });

    acceptsDefaultOptions({
      workflow: { name: "any-workflow" },
    });

    acceptsDefaultOptions({});
  });

  it("rejects legacy options shape in typed overload", () => {
    const acceptsTypedOptions = (_options: ListWorkflowExecutionsTypedOptions): void => {};

    acceptsTypedOptions({
      // @ts-expect-error - typed overload requires workflow, not workflowName
      workflowName: "legacy-workflow",
    });
  });

  it("keeps deprecated ListWorkflowExecutionsOptions shape available", () => {
    const acceptsDeprecatedOptions = (_options: ListWorkflowExecutionsOptions): void => {};

    acceptsDeprecatedOptions({
      workflowName: "legacy-workflow",
    });

    acceptsDeprecatedOptions({
      workflowName: "legacy-workflow",
      status: "RUNNING",
      order: "asc",
      limit: 10,
      workspaceId: "ws-1",
      profile: "dev",
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy workflowName shape
      workflow: myWorkflow,
    });
  });
});
