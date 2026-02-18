import { describe, expectTypeOf, it } from "vitest";
import { defineAuth } from "@/configure/services/auth";
import { db } from "@/configure/services/tailordb";
import { createWorkflow, createWorkflowJob } from "@/configure/services/workflow";
import { type StartWorkflowOptions } from "./start";

const userType = db.type("User", {
  email: db.string().unique(),
});

const auth = defineAuth("main-auth", {
  userProfile: {
    type: userType,
    usernameField: "email",
  },
  machineUsers: {
    admin: {},
    worker: {},
  },
});

const calculationJob = createWorkflowJob({
  name: "calculation",
  body: (input: { a: number; b: number }) => ({ sum: input.a + input.b }),
});

const calculationWorkflow = createWorkflow({
  name: "calculation-workflow",
  mainJob: calculationJob,
});

const noInputJob = createWorkflowJob({
  name: "no-input",
  body: () => ({ ok: true as const }),
});

const noInputWorkflow = createWorkflow({
  name: "no-input-workflow",
  mainJob: noInputJob,
});

const acceptsCalculationWorkflowOptions = (
  _options: StartWorkflowOptions<typeof calculationWorkflow>,
): void => {};

const acceptsNoInputWorkflowOptions = (
  _options: StartWorkflowOptions<typeof noInputWorkflow>,
): void => {};

const acceptsDefaultWorkflowOptions = (_options: StartWorkflowOptions): void => {};

describe("startWorkflow API types", () => {
  it("infers arg type from workflow", () => {
    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { a: 1, b: 2 },
    });

    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
      // @ts-expect-error - arg shape must match workflow input
      arg: { x: 1, y: 2 },
    });

    type CalculationArg = StartWorkflowOptions<typeof calculationWorkflow>["arg"];
    expectTypeOf<CalculationArg>().toEqualTypeOf<{ a: number; b: number }>();
  });

  it("requires arg when workflow input exists", () => {
    // @ts-expect-error - arg is required for workflows with input
    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
    });
  });

  it("does not allow arg for workflows without input", () => {
    acceptsNoInputWorkflowOptions({
      workflow: noInputWorkflow,
      authInvoker: auth.invoker("admin"),
    });

    acceptsNoInputWorkflowOptions({
      workflow: noInputWorkflow,
      authInvoker: auth.invoker("admin"),
      // @ts-expect-error - no-input workflow must not receive arg
      arg: { any: "value" },
    });
  });

  it("keeps machine user names type-safe via auth.invoker", () => {
    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("worker"),
      arg: { a: 1, b: 2 },
    });

    // @ts-expect-error - invalid machine user name
    auth.invoker("invalid-machine-user");
  });

  it("keeps default generic usable when StartWorkflowOptions generic is omitted", () => {
    acceptsDefaultWorkflowOptions({
      workflow: noInputWorkflow,
      authInvoker: auth.invoker("admin"),
    });

    acceptsDefaultWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { a: 1, b: 2 },
    });
  });
});
