import { describe, it, expect, expectTypeOf } from "vitest";
import { createWorkflowJob, type WorkflowJob } from "./job";
import { waitPoint } from "./wait-point";

describe("WorkflowJob type inference", () => {
  it("preserves literal types in output when using as const", () => {
    const _job = createWorkflowJob({
      name: "test",
      body: () => ({ status: "ok" as const, count: 42 }),
    });
    // status should be "ok" (literal), count should be number
    type Output = Awaited<ReturnType<typeof _job.trigger>>;
    expectTypeOf<Output>().toEqualTypeOf<{ status: "ok"; count: number }>();
  });

  it("preserves union types in input", () => {
    const _job = createWorkflowJob({
      name: "test",
      body: (input: { type: "a" | "b" }) => ({ result: input.type }),
    });
    type Input = Parameters<typeof _job.trigger>[0];
    expectTypeOf<Input>().toEqualTypeOf<{ type: "a" | "b" }>();
  });

  it("allows interface for input type", () => {
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

  it("allows interface for output type", () => {
    interface UserOutput {
      id: string;
      created: boolean;
    }
    const _job = createWorkflowJob({
      name: "test",
      body: (): UserOutput => ({ id: "123", created: true }),
    });
    type Output = Awaited<ReturnType<typeof _job.trigger>>;
    expectTypeOf<Output>().toEqualTypeOf<UserOutput>();
  });
});

describe("WorkflowJob type constraints", () => {
  describe("input constraints", () => {
    it("allows JsonValue compatible input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { id: string; count: number }) => ({ result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows nested JsonValue input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { data: { nested: { value: string } } }) => ({
          result: "ok",
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows array input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (_input: { items: string[] }) => ({ result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("rejects Date in input", () => {
      // Date is not JsonValue, so this should cause a type error on the body parameter
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - Date is not allowed in input (not JsonValue)
        body: (_input: { date: Date }) => ({ result: "ok" }),
      });
    });

    it("rejects objects with toJSON in input", () => {
      // Objects with toJSON are not JsonValue
      createWorkflowJob({
        name: "test",
        // @ts-expect-error - Objects with toJSON are not allowed in input
        body: (_input: { custom: { toJSON: () => string } }) => ({
          result: "ok",
        }),
      });
    });
  });

  describe("output constraints", () => {
    it("allows JsonValue compatible output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ result: "ok", count: 42 }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows Date in output (Jsonifiable)", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ timestamp: new Date() }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows objects with toJSON in output", () => {
      const customObj = {
        value: 42,
        toJSON: () => ({ serialized: 42 }),
      };
      const job = createWorkflowJob({
        name: "test",
        body: () => customObj,
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows async body returning Jsonifiable", async () => {
      const job = createWorkflowJob({
        name: "test",
        body: async () => ({ timestamp: new Date(), result: "ok" }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows undefined output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => undefined,
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows void output (no return statement)", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => {
          console.log("side effect only");
        },
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows T | undefined output", () => {
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
    it("returns Jsonify<Output> - Date becomes string", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ timestamp: new Date() }),
      });
      // trigger returns Promise where Date is converted to string via Jsonify
      expectTypeOf(job.trigger).returns.resolves.toEqualTypeOf<{
        timestamp: string;
      }>();
    });

    it("returns Jsonify<Output> for nested Date", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({
          data: {
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      });
      expectTypeOf(job.trigger).returns.resolves.toEqualTypeOf<{
        data: {
          createdAt: string;
          updatedAt: string;
        };
      }>();
    });

    it("keeps primitive types unchanged", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ result: "ok", count: 42, active: true as boolean }),
      });
      expectTypeOf(job.trigger).returns.resolves.toEqualTypeOf<{
        result: string;
        count: number;
        active: boolean;
      }>();
    });

    it("returns undefined for undefined output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => undefined,
      });
      expectTypeOf(job.trigger).returns.resolves.toEqualTypeOf<undefined>();
    });

    it("returns T | undefined for T | undefined output", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (): { value: number } | undefined => {
          return Math.random() > 0.5 ? { value: 1 } : undefined;
        },
      });
      expectTypeOf(job.trigger).returns.resolves.toEqualTypeOf<{ value: number } | undefined>();
    });
  });

  describe("input presence affects trigger signature", () => {
    it("trigger takes no arguments when input is undefined", () => {
      const job = createWorkflowJob({
        name: "test",
        body: () => ({ result: "ok" }),
      });
      // trigger should be callable without arguments
      // Using type assertion to verify the signature
      const _trigger: () => Promise<{ result: string }> = job.trigger;
      expectTypeOf(_trigger).toBeFunction();
    });

    it("trigger requires input when body has input parameter", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { id: string }) => ({ result: input.id }),
      });
      // trigger should require the input parameter
      // Using type assertion to verify the signature
      const _trigger: (input: { id: string }) => Promise<{ result: string }> = job.trigger;
      expectTypeOf(_trigger).toBeFunction();
    });
  });

  describe("WorkflowJob interface constraints", () => {
    it("WorkflowJob Input constraint is JsonValue | undefined", () => {
      // This should compile - JsonValue input
      type ValidJob1 = WorkflowJob<"test", { id: string }, { result: string }>;

      // This should compile - undefined input
      type ValidJob2 = WorkflowJob<"test", undefined, { result: string }>;

      // Verify the types are valid
      expectTypeOf<ValidJob1["name"]>().toEqualTypeOf<"test">();
      expectTypeOf<ValidJob2["name"]>().toEqualTypeOf<"test">();
    });

    it("WorkflowJob Output constraint is Jsonifiable", () => {
      // This should compile - Date is Jsonifiable
      type ValidJob = WorkflowJob<"test", undefined, { timestamp: Date; result: string }>;

      // Verify trigger return is Jsonify<Output>
      expectTypeOf<ReturnType<ValidJob["trigger"]>>().resolves.toEqualTypeOf<{
        timestamp: string;
        result: string;
      }>();
    });
  });

  describe("input with optional fields", () => {
    it("allows optional string field in input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { prompt: string; system?: string }) => ({
          result: input.system ?? "default",
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows multiple optional fields in input", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { required: string; optional1?: string; optional2?: number }) => ({
          result: input.required,
          hasOptional: input.optional1 !== undefined,
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows explicit union with undefined", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { value: string | undefined }) => ({
          result: input.value ?? "none",
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows nested objects with optional fields", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { data: { required: string; metadata?: { tag?: string } } }) => ({
          result: input.data.required,
          hasMetadata: input.data.metadata !== undefined,
        }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("allows arrays with optional element types", () => {
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
    it("allows optional fields in output", () => {
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

describe("WorkflowJob with waitPoints", () => {
  describe("type inference", () => {
    it("wait function key parameter is typed from waitPoints keys", () => {
      const job = createWorkflowJob({
        name: "test",
        waitPoints: {
          approval: waitPoint<{ message: string }, { approved: boolean }>(),
          review: waitPoint<{ doc: string }, { score: number }>(),
        },
        body: async (_input: { id: string }, { wait }) => {
          // wait should accept "approval" or "review" as keys
          const a = await wait("approval", { message: "test" });
          expectTypeOf(a).toEqualTypeOf<{ approved: boolean }>();

          const r = await wait("review", { doc: "doc-1" });
          expectTypeOf(r).toEqualTypeOf<{ score: number }>();

          return { approved: a.approved, score: r.score };
        },
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
    });

    it("resolve method key parameter is typed from waitPoints keys", () => {
      const job = createWorkflowJob({
        name: "test",
        waitPoints: {
          approval: waitPoint<{ message: string }, { approved: boolean }>(),
        },
        body: async (_input: undefined, { wait }) => {
          return await wait("approval", { message: "test" });
        },
      });

      // resolve should be a valid function accepting "approval" as key
      expectTypeOf(job.resolve).toBeFunction();
    });

    it("resolve callback receives typed payload and returns typed result", () => {
      const job = createWorkflowJob({
        name: "test",
        waitPoints: {
          approval: waitPoint<{ message: string }, { approved: boolean }>(),
        },
        body: async (_input: undefined, { wait }) => {
          return await wait("approval", { message: "test" });
        },
      });

      // Verify resolve callback types
      type ResolveFn = typeof job.resolve;
      expectTypeOf<ResolveFn>().toBeFunction();
    });

    it("wait with undefined payload requires no argument", () => {
      const _job = createWorkflowJob({
        name: "test",
        waitPoints: {
          signal: waitPoint<undefined, { done: boolean }>(),
        },
        body: async (_input: undefined, { wait }) => {
          // Should be callable without payload
          const result = await wait("signal");
          return result;
        },
      });
    });

    it("wait return type applies JsonifyOutput (Date→string)", () => {
      const _job = createWorkflowJob({
        name: "test",
        waitPoints: {
          check: waitPoint<undefined, { timestamp: Date }>(),
        },
        body: async (_input: undefined, { wait }) => {
          const result = await wait("check");
          // timestamp should be string (Date becomes string via Jsonify)
          expectTypeOf(result.timestamp).toEqualTypeOf<string>();
          return result;
        },
      });
    });
  });

  describe("backward compatibility", () => {
    it("jobs without waitPoints still work", () => {
      const job = createWorkflowJob({
        name: "test",
        body: (input: { id: string }) => ({ result: input.id }),
      });
      expectTypeOf(job.name).toEqualTypeOf<"test">();
      // trigger still works the same
      const _trigger: (input: { id: string }) => Promise<{ result: string }> = job.trigger;
      expectTypeOf(_trigger).toBeFunction();
    });
  });

  describe("local testing: wait/resolve coordination", () => {
    it("wait resolves when resolve is called", async () => {
      const job = createWorkflowJob({
        name: "test-wait",
        waitPoints: {
          approval: waitPoint<{ message: string }, { approved: boolean }>(),
        },
        body: async (input: { id: string }, { wait }) => {
          const result = await wait("approval", { message: `Approve ${input.id}?` });
          return { id: input.id, approved: result.approved };
        },
      });

      // Start the trigger (will block on wait)
      const resultPromise = job.trigger({ id: "123" });

      // Resolve the wait
      await job.resolve("approval", "exec-1", (payload) => {
        expect(payload).toEqual({ message: "Approve 123?" });
        return { approved: true };
      });

      // Now the trigger should complete
      const result = await resultPromise;
      expect(result).toEqual({ id: "123", approved: true });
    });

    it("resolve callback result is JSON-serialized", async () => {
      const job = createWorkflowJob({
        name: "test-json",
        waitPoints: {
          check: waitPoint<undefined, { timestamp: Date }>(),
        },
        body: async (_input: undefined, { wait }) => {
          return await wait("check");
        },
      });

      const resultPromise = job.trigger();

      await job.resolve("check", "exec-1", () => {
        return { timestamp: new Date("2025-01-01T00:00:00.000Z") };
      });

      const result = await resultPromise;
      // Date should be converted to string via JSON serialization
      expect(result).toEqual({ timestamp: "2025-01-01T00:00:00.000Z" });
    });

    it("throws when resolving without a pending wait", async () => {
      const job = createWorkflowJob({
        name: "test-no-wait",
        waitPoints: {
          approval: waitPoint<undefined, undefined>(),
        },
        body: async () => undefined,
      });

      await expect(job.resolve("approval", "exec-1", () => undefined)).rejects.toThrow(
        'No pending wait for key "approval"',
      );
    });
  });
});
