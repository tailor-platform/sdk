// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test } from "vitest";
import { createWorkflow, createWorkflowJob } from "#/configure/services/workflow/index";
import { type GetWorkflowOptions, type GetWorkflowTypedOptions } from "./get";

const mainJob = createWorkflowJob({
  name: "main",
  body: () => ({ ok: true as const }),
});

const myWorkflow = createWorkflow({
  name: "my-workflow",
  mainJob,
});

describe("getWorkflow API types", () => {
  test("accepts typed options with workflow definition", () => {
    const acceptsOptions = (_options: GetWorkflowTypedOptions<typeof myWorkflow>): void => {};

    acceptsOptions({
      workflow: myWorkflow,
    });

    acceptsOptions({
      workflow: myWorkflow,
      workspaceId: "ws-1",
      profile: "dev",
    });
  });

  test("works with default generic when GetWorkflowTypedOptions generic is omitted", () => {
    const acceptsDefaultOptions = (_options: GetWorkflowTypedOptions): void => {};

    acceptsDefaultOptions({
      workflow: myWorkflow,
    });

    acceptsDefaultOptions({
      workflow: { name: "any-workflow" },
    });
  });

  test("rejects legacy options shape in typed overload", () => {
    const acceptsTypedOptions = (_options: GetWorkflowTypedOptions): void => {};

    acceptsTypedOptions({
      // @ts-expect-error - typed overload requires workflow, not name
      name: "legacy-workflow",
    });
  });

  test("keeps deprecated GetWorkflowOptions shape available", () => {
    const acceptsDeprecatedOptions = (_options: GetWorkflowOptions): void => {};

    acceptsDeprecatedOptions({
      name: "legacy-workflow",
    });

    acceptsDeprecatedOptions({
      name: "legacy-workflow",
      workspaceId: "ws-1",
      profile: "dev",
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy name shape
      workflow: myWorkflow,
    });
  });
});
