import { describe, expectTypeOf, it } from "vitest";
import { defineAuth } from "@/configure/services/auth";
import { db } from "@/configure/services/tailordb";
import { createWorkflow, createWorkflowJob } from "@/configure/services/workflow";
import { type StartWorkflowOptions, type StartWorkflowTypedOptions } from "./start";

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

const textJob = createWorkflowJob({
  name: "text",
  body: (input: { message: string }) => ({ message: input.message }),
});

const textWorkflow = createWorkflow({
  name: "text-workflow",
  mainJob: textJob,
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

type PlainWorkflowA = {
  name: "plain-a";
  mainJob: {
    body: (input: { foo: number }) => { foo: number };
  };
};

type PlainWorkflowB = {
  name: "plain-b";
  mainJob: {
    body: (input: { bar: string }) => { bar: string };
  };
};

const plainWorkflowA: PlainWorkflowA = {
  name: "plain-a",
  mainJob: {
    body: (input) => ({ foo: input.foo }),
  },
};

const plainWorkflowB: PlainWorkflowB = {
  name: "plain-b",
  mainJob: {
    body: (input) => ({ bar: input.bar }),
  },
};

const acceptsCalculationWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof calculationWorkflow>,
): void => {};

const acceptsNoInputWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof noInputWorkflow>,
): void => {};

const acceptsOptionalInputWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof optionalInputWorkflow>,
): void => {};

const acceptsUndefinedableInputWorkflowOptions = (
  _options: StartWorkflowTypedOptions<UndefinedableInputWorkflow>,
): void => {};

const acceptsDefaultWorkflowOptions = (_options: StartWorkflowTypedOptions): void => {};
const acceptsDeprecatedOptions = (_options: StartWorkflowOptions): void => {};
const acceptsUnionWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof calculationWorkflow | typeof noInputWorkflow>,
): void => {};
const acceptsUnionInputWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof calculationWorkflow | typeof textWorkflow>,
): void => {};
const acceptsMixedWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof calculationWorkflow | typeof optionalInputWorkflow>,
): void => {};
const acceptsPlainUnionWorkflowOptions = (
  _options: StartWorkflowTypedOptions<PlainWorkflowA | PlainWorkflowB>,
): void => {};

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

    type CalculationArg = StartWorkflowTypedOptions<typeof calculationWorkflow>["arg"];
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

    type OptionalArg = StartWorkflowTypedOptions<typeof optionalInputWorkflow>["arg"];
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

    type UndefinedableArg = StartWorkflowTypedOptions<UndefinedableInputWorkflow>["arg"];
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

  it("keeps default generic usable when StartWorkflowTypedOptions generic is omitted", () => {
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

  it("supports union workflow types without collapsing arg type", () => {
    acceptsUnionWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { a: 1, b: 2 },
    });

    acceptsUnionWorkflowOptions({
      workflow: noInputWorkflow,
      authInvoker: auth.invoker("admin"),
    });
  });

  it("supports union workflow input types without collapsing arg type", () => {
    acceptsUnionInputWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { a: 1, b: 2 },
    });

    acceptsUnionInputWorkflowOptions({
      workflow: textWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { message: "hello" },
    });

    type UnionInputArg = StartWorkflowTypedOptions<
      typeof calculationWorkflow | typeof textWorkflow
    >["arg"];
    expectTypeOf<UnionInputArg>().toEqualTypeOf<{ a: number; b: number } | { message: string }>();
  });

  it("keeps workflow-specific arg requirements for mixed union workflows", () => {
    acceptsMixedWorkflowOptions({
      workflow: optionalInputWorkflow,
      authInvoker: auth.invoker("admin"),
    });

    acceptsMixedWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { a: 1, b: 2 },
    });

    // @ts-expect-error - calculation workflow branch still requires arg
    acceptsMixedWorkflowOptions({
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
    });
  });

  it("supports plain workflow unions without collapsing arg type", () => {
    acceptsPlainUnionWorkflowOptions({
      workflow: plainWorkflowA,
      authInvoker: auth.invoker("admin"),
      arg: { foo: 1 },
    });

    acceptsPlainUnionWorkflowOptions({
      workflow: plainWorkflowB,
      authInvoker: auth.invoker("admin"),
      arg: { bar: "x" },
    });

    type PlainUnionArg = StartWorkflowTypedOptions<PlainWorkflowA | PlainWorkflowB>["arg"];
    expectTypeOf<PlainUnionArg>().toEqualTypeOf<{ foo: number } | { bar: string }>();
  });

  it("keeps deprecated StartWorkflowOptions shape available", () => {
    acceptsDeprecatedOptions({
      name: "legacy-workflow",
      machineUser: "admin",
    });

    acceptsDeprecatedOptions({
      name: "legacy-workflow",
      machineUser: "admin",
      arg: { any: "value" },
      configPath: "./tailor.config.ts",
    });

    acceptsDeprecatedOptions({
      // @ts-expect-error - deprecated options must keep legacy name/machineUser shape
      workflow: calculationWorkflow,
      authInvoker: auth.invoker("admin"),
      arg: { a: 1, b: 2 },
    });
  });
});
