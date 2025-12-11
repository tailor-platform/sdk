import { describe, it, expectTypeOf } from "vitest";
import { createWorkflowJob, type WorkflowJob } from "./job";

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
      expectTypeOf(job.trigger).returns.resolves.toEqualTypeOf<
        { value: number } | undefined
      >();
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
      const _trigger: (input: { id: string }) => Promise<{ result: string }> =
        job.trigger;
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
      type ValidJob = WorkflowJob<
        "test",
        undefined,
        { timestamp: Date; result: string }
      >;

      // Verify trigger return is Jsonify<Output>
      expectTypeOf<ReturnType<ValidJob["trigger"]>>().resolves.toEqualTypeOf<{
        timestamp: string;
        result: string;
      }>();
    });
  });
});
