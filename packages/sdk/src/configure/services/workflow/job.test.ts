// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import { describe, expect, test, expectTypeOf } from "vitest";
import { platformSerialize } from "#/utils/test/platform-serialize";
import { createWorkflowJob, type WorkflowJob } from "./job";
import { getRegisteredJob } from "./registry";
import { buildJobContext } from "./test-env-key";
import { createWorkflow } from "./workflow";
import type { TailorPrincipal } from "#/runtime/types";

async function withRegisteredJobRuntime<T>(run: () => Promise<T>): Promise<T> {
  const root = globalThis as {
    tailor?: {
      workflow?: {
        triggerJobFunction: (name: string, args?: unknown) => unknown;
      };
    };
  };
  const previousTailor = root.tailor;

  root.tailor = {
    ...previousTailor,
    workflow: {
      triggerJobFunction: (name, args) => {
        const body = getRegisteredJob(name);
        if (!body) return null;
        const out = body(platformSerialize(args), buildJobContext());
        return out instanceof Promise
          ? out.then((value) => platformSerialize(value))
          : platformSerialize(out);
      },
    },
  };

  try {
    return await run();
  } finally {
    if (previousTailor) {
      root.tailor = previousTailor;
    } else {
      delete root.tailor;
    }
  }
}

describe("WorkflowJob type inference", () => {
  test("preserves literal types in output when using as const", () => {
    const _job = createWorkflowJob({
      name: "test",
      body: () => ({ status: "ok" as const, count: 42 }),
    });
    type Output = ReturnType<typeof _job.trigger>;
    expectTypeOf<Output>().toEqualTypeOf<{ status: "ok"; count: number }>();
  });

  test("preserves union types in input", () => {
    const _job = createWorkflowJob({
      name: "test",
      body: (input: { type: "a" | "b" }) => ({ result: input.type }),
    });
    type Input = Parameters<typeof _job.trigger>[0];
    expectTypeOf<Input>().toEqualTypeOf<{ type: "a" | "b" }>();
  });

  test("allows interface for input type", () => {
    interface UserInput {
      name: string;
      age: number;
    }
    const _job = createWorkflowJob({
      name: "test",
      body: (input: UserInput) => ({ greeting: `Hello ${input.name}` }),
    });
    type Input = Parameters<typeof _job.trigger>[0];
    expectTypeOf<Input>().toEqualTypeOf<UserInput>();
  });

  test("allows interface for output type", () => {
    interface UserOutput {
      id: string;
      created: boolean;
    }
    const _job = createWorkflowJob({
      name: "test",
      body: (): UserOutput => ({ id: "123", created: true }),
    });
    type Output = ReturnType<typeof _job.trigger>;
    expectTypeOf<Output>().toEqualTypeOf<UserOutput>();
  });

  test("context exposes invoker field alongside env", () => {
    createWorkflowJob({
      name: "test",
      body: (_input: undefined, context) => {
        expectTypeOf(context).toHaveProperty("env");
        expectTypeOf(context).toHaveProperty("invoker");
        expectTypeOf(context.invoker).toEqualTypeOf<TailorPrincipal | null>();
      },
    });
  });

  test("direct body calls work when process.getBuiltinModule is unavailable", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "getBuiltinModule");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: undefined,
    });
    try {
      const invoker: TailorPrincipal = {
        id: "principal-1",
        type: "user",
        workspaceId: "workspace-1",
        attributes: {},
        attributeList: [],
      };
      const child = createWorkflowJob({
        name: "capture-child-invoker-without-get-builtin-module",
        body: (_input: undefined, context) => context.invoker?.id ?? "anonymous",
      });
      const parent = createWorkflowJob({
        name: "propagate-parent-invoker-without-get-builtin-module",
        body: async () => await child.trigger(),
      });

      await withRegisteredJobRuntime(async () => {
        await expect(parent.body(undefined, { env: {}, invoker })).resolves.toBe("principal-1");
      });
    } finally {
      if (descriptor) {
        Object.defineProperty(process, "getBuiltinModule", descriptor);
      } else {
        delete (process as { getBuiltinModule?: unknown }).getBuiltinModule;
      }
    }
  });

  test("direct body calls propagate invoker to triggered child jobs", async () => {
    const invoker: TailorPrincipal = {
      id: "principal-1",
      type: "user",
      workspaceId: "workspace-1",
      attributes: { role: "ADMIN" },
      attributeList: [],
    };
    const child = createWorkflowJob({
      name: "capture-child-invoker",
      body: (_input: undefined, context) => context.invoker?.id ?? "anonymous",
    });
    const parent = createWorkflowJob({
      name: "propagate-parent-invoker",
      body: async () => await child.trigger(),
    });

    await withRegisteredJobRuntime(async () => {
      await expect(parent.body(undefined, { env: {}, invoker })).resolves.toBe("principal-1");
    });
  });

  test("concurrent direct body calls isolate invokers for child triggers", async () => {
    const firstInvoker: TailorPrincipal = {
      id: "principal-1",
      type: "user",
      workspaceId: "workspace-1",
      attributes: {},
      attributeList: [],
    };
    const secondInvoker: TailorPrincipal = {
      id: "principal-2",
      type: "machine_user",
      workspaceId: "workspace-1",
      attributes: {},
      attributeList: [],
    };
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const gates = {
      first: firstGate,
      second: secondGate,
    };
    const child = createWorkflowJob({
      name: "capture-concurrent-child-invoker",
      body: (_input: undefined, context) => context.invoker?.id ?? "anonymous",
    });
    const parent = createWorkflowJob({
      name: "capture-concurrent-parent-invoker",
      body: async (input: { gate: "first" | "second" }) => {
        await gates[input.gate];
        return await child.trigger();
      },
    });

    await withRegisteredJobRuntime(async () => {
      const first = parent.body({ gate: "first" }, { env: {}, invoker: firstInvoker });
      const second = parent.body({ gate: "second" }, { env: {}, invoker: secondInvoker });

      releaseFirst();
      await expect(first).resolves.toBe("principal-1");
      releaseSecond();
      await expect(second).resolves.toBe("principal-2");
    });
  });

  test("trigger reads the runtime invoker when no body context is active", async () => {
    const previousTailor = (globalThis as { tailor?: unknown }).tailor;
    (globalThis as { tailor?: unknown }).tailor = {
      context: {
        getInvoker: () => ({
          id: "runtime-principal",
          type: "machine_user",
          workspaceId: "workspace-1",
          attributes: ["role"],
          attributeMap: { role: "SYSTEM" },
        }),
      },
    };
    try {
      const job = createWorkflowJob({
        name: "capture-runtime-invoker",
        body: (_input: undefined, context) => context.invoker?.id ?? "anonymous",
      });

      await withRegisteredJobRuntime(async () => {
        expect(job.trigger()).toBe("runtime-principal");
      });
    } finally {
      (globalThis as { tailor?: unknown }).tailor = previousTailor;
    }
  });
});

describe("WorkflowJob type constraints", () => {
  describe("input constraints", () => {
    test("allows JsonValue compatible input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { id: string; count: number }) => ({ result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows nested JsonValue input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { data: { nested: { value: string } } }) => ({
          result: "ok",
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows array input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { items: string[] }) => ({ result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("rejects Date in input", () => {
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - Date is not JsonValue-compatible
        body: (_input: { date: Date }) => ({ result: "ok" }),
      });
    });

    test("rejects objects with toJSON in input", () => {
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - objects with methods (function-typed properties) are not JsonValue-compatible
        body: (_input: { custom: { toJSON: () => string } }) => ({
          result: "ok",
        }),
      });
    });

    test("rejects null as top-level input", () => {
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - null is not allowed at top level
        body: (_input: null) => ({ result: "ok" }),
      });
    });

    test("rejects null in top-level union input", () => {
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - null is not allowed at top level (even in union)
        body: (_input: { id: string } | null) => ({ result: "ok" }),
      });
    });

    test("rejects undefined in top-level union input", () => {
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - undefined is not allowed at top level (except when I = undefined alone)
        body: (_input: { id: string } | undefined) => ({ result: "ok" }),
      });
    });

    test("allows input = undefined (no-input convention)", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: undefined) => ({ result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows nested null in object input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { data: string | null }) => ({ result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows nested null in array input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { items: (string | null)[] }) => ({ result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });
  });

  describe("output constraints", () => {
    test("allows JsonValue compatible output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ result: "ok", count: 42 }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("rejects Date in output", () => {
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - Date is not JsonValue-compatible
        body: () => ({ timestamp: new Date() }),
      });
    });

    test("rejects objects with toJSON in output", () => {
      const customObj = {
        value: 42,
        toJSON: () => ({ serialized: 42 }),
      };
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - objects with methods (function-typed properties) are not JsonValue-compatible
        body: () => customObj,
      });
    });

    test("rejects async body returning Date", async () => {
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - Date is not JsonValue-compatible
        body: async () => ({ timestamp: new Date(), result: "ok" }),
      });
    });

    test("allows undefined output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => undefined,
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows void output (no return statement)", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => {
          console.log("side effect only");
        },
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows T | undefined output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => {
          const result = Math.random() > 0.5 ? { value: 1 } : undefined;
          return result;
        },
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });
  });

  describe("trigger return type", () => {
    test("returns Output as-is (no Jsonify transformation)", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ result: "ok", count: 42, active: true as boolean }),
      });
      expectTypeOf(job.trigger).returns.toEqualTypeOf<{
        result: string;
        count: number;
        active: boolean;
      }>();
    });

    test("keeps nested object types unchanged", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({
          data: {
            id: "x",
            tags: ["a", "b"],
          },
        }),
      });
      expectTypeOf(job.trigger).returns.toEqualTypeOf<{
        data: {
          id: string;
          tags: string[];
        };
      }>();
    });

    test("returns undefined for undefined output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => undefined,
      });
      expectTypeOf(job.trigger).returns.toEqualTypeOf<undefined>();
    });

    test("returns T | undefined for T | undefined output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (): { value: number } | undefined => {
          return Math.random() > 0.5 ? { value: 1 } : undefined;
        },
      });
      expectTypeOf(job.trigger).returns.toEqualTypeOf<{ value: number } | undefined>();
    });
  });

  describe("input presence affects trigger signature", () => {
    test("trigger takes no arguments when input is undefined", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ result: "ok" }),
      });
      const _trigger: () => { result: string } = job.trigger;
      expectTypeOf(_trigger).toBeFunction();
    });

    test("trigger requires input when body has input parameter", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { id: string }) => ({ result: input.id }),
      });
      const _trigger: (input: { id: string }) => { result: string } = job.trigger;
      expectTypeOf(_trigger).toBeFunction();
    });
  });

  describe("WorkflowJob interface constraints", () => {
    test("WorkflowJob Input constraint is JsonValue | undefined", () => {
      type ValidJob1 = WorkflowJob<"test", { id: string }, { result: string }>;
      type ValidJob2 = WorkflowJob<"test", undefined, { result: string }>;

      expectTypeOf<ValidJob1["name"]>().toEqualTypeOf<"test">();
      expectTypeOf<ValidJob2["name"]>().toEqualTypeOf<"test">();
    });

    test("trigger return preserves Output as-is", () => {
      type Job = WorkflowJob<"test", undefined, { id: string; result: string }>;

      expectTypeOf<ReturnType<Job["trigger"]>>().toEqualTypeOf<{
        id: string;
        result: string;
      }>();
    });
  });

  describe("input with optional fields", () => {
    test("allows optional string field in input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { prompt: string; system?: string }) => ({
          result: input.system ?? "default",
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows multiple optional fields in input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { required: string; optional1?: string; optional2?: number }) => ({
          result: input.required,
          hasOptional: input.optional1 !== undefined,
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows explicit union with undefined", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { value: string | undefined }) => ({
          result: input.value ?? "none",
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows nested objects with optional fields", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { data: { required: string; metadata?: { tag?: string } } }) => ({
          result: input.data.required,
          hasMetadata: input.data.metadata !== undefined,
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    test("allows arrays with optional element types", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { items: (string | undefined)[] }) => ({
          count: input.items.length,
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });
  });

  describe("output with optional fields", () => {
    test("allows optional fields in output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (): { value: string; metadata?: string } => {
          return Math.random() > 0.5 ? { value: "test", metadata: "info" } : { value: "test" };
        },
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });
  });
});

// Plain `node` environment (no `tailor-runtime`, no `mockWorkflow()`), so
// `.trigger()` should not execute job bodies locally.
describe("trigger without tailor.workflow", () => {
  test("job trigger throws instead of running the registered body", () => {
    const double = createWorkflowJob({
      name: "fallback-double",
      body: (input: { n: number }) => ({ doubled: input.n * 2 }),
    });

    expect(() => double.trigger({ n: 21 })).toThrow(/tailor\.workflow is not available/);
  });

  test("workflow trigger rejects instead of running the main job", async () => {
    const main = createWorkflowJob({
      name: "fallback-main",
      body: (input: { n: number }) => ({ total: input.n + 1 }),
    });
    const workflow = createWorkflow({ name: "fallback-wf", mainJob: main });

    await expect(workflow.trigger({ n: 0 })).rejects.toThrow(/tailor\.workflow is not available/);
  });
});
