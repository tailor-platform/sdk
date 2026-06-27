// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, test, expectTypeOf } from "vitest";
import { createWorkflow, createWorkflowJob } from "#/configure/services/workflow/index";
import { type StartWorkflowOptions, type StartWorkflowTypedOptions } from "./start";

// `invoker` is typed as `MachineUserName`, which falls back to `string` until
// `tailor.d.ts` augments `MachineUserNameRegistry`. Narrowing to the registered
// machine user union (and rejection of unknown names) is covered against a real
// generated `tailor.d.ts` in `example/`; here we only assert arg inference and
// that machine user names are accepted as strings.
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

const acceptsDefaultWorkflowOptions = (_options: StartWorkflowTypedOptions): void => {};
const acceptsDeprecatedOptions = (_options: StartWorkflowOptions): void => {};
const acceptsUnionWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof calculationWorkflow | typeof noInputWorkflow>,
): void => {};
const acceptsUnionInputWorkflowOptions = (
  _options: StartWorkflowTypedOptions<typeof calculationWorkflow | typeof textWorkflow>,
): void => {};
const acceptsPlainUnionWorkflowOptions = (
  _options: StartWorkflowTypedOptions<PlainWorkflowA | PlainWorkflowB>,
): void => {};

describe("startWorkflow API types", () => {
  test("infers arg type from workflow", () => {
    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      invoker: "admin",
      arg: { a: 1, b: 2 },
    });

    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      invoker: "admin",
      // @ts-expect-error - arg shape must match workflow input
      arg: { x: 1, y: 2 },
    });

    type CalculationArg = StartWorkflowTypedOptions<typeof calculationWorkflow>["arg"];
    expectTypeOf<CalculationArg>().toEqualTypeOf<{ a: number; b: number }>();
  });

  test("requires arg when workflow input exists", () => {
    // @ts-expect-error - arg is required for workflows with input
    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      invoker: "admin",
    });
  });

  test("does not allow arg for workflows without input", () => {
    acceptsNoInputWorkflowOptions({
      workflow: noInputWorkflow,
      invoker: "admin",
    });

    acceptsNoInputWorkflowOptions({
      workflow: noInputWorkflow,
      invoker: "admin",
      // @ts-expect-error - no-input workflow must not receive arg
      arg: { any: "value" },
    });
  });

  test("accepts machine user names as strings", () => {
    acceptsCalculationWorkflowOptions({
      workflow: calculationWorkflow,
      invoker: "worker",
      arg: { a: 1, b: 2 },
    });
  });

  test("keeps default generic usable when StartWorkflowTypedOptions generic is omitted", () => {
    acceptsDefaultWorkflowOptions({
      workflow: noInputWorkflow,
      invoker: "admin",
    });

    acceptsDefaultWorkflowOptions({
      workflow: calculationWorkflow,
      invoker: "admin",
      arg: { a: 1, b: 2 },
    });
  });

  test("supports union workflow types without collapsing arg type", () => {
    acceptsUnionWorkflowOptions({
      workflow: calculationWorkflow,
      invoker: "admin",
      arg: { a: 1, b: 2 },
    });

    acceptsUnionWorkflowOptions({
      workflow: noInputWorkflow,
      invoker: "admin",
    });
  });

  test("supports union workflow input types without collapsing arg type", () => {
    acceptsUnionInputWorkflowOptions({
      workflow: calculationWorkflow,
      invoker: "admin",
      arg: { a: 1, b: 2 },
    });

    acceptsUnionInputWorkflowOptions({
      workflow: textWorkflow,
      invoker: "admin",
      arg: { message: "hello" },
    });

    type UnionInputArg = StartWorkflowTypedOptions<
      typeof calculationWorkflow | typeof textWorkflow
    >["arg"];
    expectTypeOf<UnionInputArg>().toEqualTypeOf<{ a: number; b: number } | { message: string }>();
  });

  test("supports plain workflow unions without collapsing arg type", () => {
    acceptsPlainUnionWorkflowOptions({
      workflow: plainWorkflowA,
      invoker: "admin",
      arg: { foo: 1 },
    });

    acceptsPlainUnionWorkflowOptions({
      workflow: plainWorkflowB,
      invoker: "admin",
      arg: { bar: "x" },
    });

    type PlainUnionArg = StartWorkflowTypedOptions<PlainWorkflowA | PlainWorkflowB>["arg"];
    expectTypeOf<PlainUnionArg>().toEqualTypeOf<{ foo: number } | { bar: string }>();
  });

  test("keeps deprecated StartWorkflowOptions shape available", () => {
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
      invoker: "admin",
      arg: { a: 1, b: 2 },
    });
  });
});
