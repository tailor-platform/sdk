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

const optionalInputJob = createWorkflowJob({
  name: "optional-input",
  body: (input?: { value: number }) => ({ value: input?.value ?? 0 }),
});

const optionalInputWorkflow = createWorkflow({
  name: "optional-input-workflow",
  mainJob: optionalInputJob,
});

type UndefinedableInputWorkflow = {
  name: "undefinedable-input-workflow";
  mainJob: {
    body: (input: { value: number } | undefined) => { value: number };
  };
};

const undefinedableInputWorkflow: UndefinedableInputWorkflow = {
  name: "undefinedable-input-workflow",
  mainJob: {
    body: (input) => ({ value: input?.value ?? 0 }),
  },
};

const acceptsCalculationWorkflowOptions = (
  _options: StartWorkflowOptions<typeof calculationWorkflow>,
): void => {};

const acceptsNoInputWorkflowOptions = (
  _options: StartWorkflowOptions<typeof noInputWorkflow>,
): void => {};

const acceptsOptionalInputWorkflowOptions = (
  _options: StartWorkflowOptions<typeof optionalInputWorkflow>,
): void => {};

const acceptsUndefinedableInputWorkflowOptions = (
  _options: StartWorkflowOptions<UndefinedableInputWorkflow>,
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

  it("allows omitting arg when workflow input includes undefined", () => {
    acceptsOptionalInputWorkflowOptions({
      workflow: optionalInputWorkflow,
      authInvoker: auth.invoker("admin"),
    });

    acceptsOptionalInputWorkflowOptions({
      workflow: optionalInputWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { value: 1 },
    });

    acceptsOptionalInputWorkflowOptions({
      workflow: optionalInputWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: undefined,
    });

    acceptsOptionalInputWorkflowOptions({
      workflow: optionalInputWorkflow,
      authInvoker: auth.invoker("admin"),
      // @ts-expect-error - arg shape must match workflow input
      arg: { invalid: true },
    });

    type OptionalArg = StartWorkflowOptions<typeof optionalInputWorkflow>["arg"];
    expectTypeOf<OptionalArg>().toEqualTypeOf<{ value: number } | undefined>();
  });

  it("allows omitting arg when workflow input is T | undefined", () => {
    acceptsUndefinedableInputWorkflowOptions({
      workflow: undefinedableInputWorkflow,
      authInvoker: auth.invoker("admin"),
    });

    acceptsUndefinedableInputWorkflowOptions({
      workflow: undefinedableInputWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { value: 1 },
    });

    acceptsUndefinedableInputWorkflowOptions({
      workflow: undefinedableInputWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: undefined,
    });

    acceptsUndefinedableInputWorkflowOptions({
      workflow: undefinedableInputWorkflow,
      authInvoker: auth.invoker("admin"),
      // @ts-expect-error - arg shape must match workflow input
      arg: { invalid: true },
    });

    type UndefinedableArg = StartWorkflowOptions<UndefinedableInputWorkflow>["arg"];
    expectTypeOf<UndefinedableArg>().toEqualTypeOf<{ value: number } | undefined>();
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
