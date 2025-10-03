import { describe, expectTypeOf, it } from "vitest";
import { createMutationResolver, createQueryResolver } from "./resolver";
import { t } from "@/types/type";

const UserInput = t.type({
  id: t.string(),
  name: t.string({ optional: true }),
});
const UserOutput = t.type({
  id: t.string(),
  name: t.string(),
  email: t.string(),
});

describe("createQueryResolver type tests", () => {
  it("初期状態の型が正しいこと", () => {
    const resolver = createQueryResolver("getUser", UserInput);
    expectTypeOf(resolver.queryType).toEqualTypeOf<"query">();
    expectTypeOf(resolver.name).toEqualTypeOf<string>();

    type InputType = typeof resolver._input;
    expectTypeOf<InputType>().toEqualTypeOf<{
      id: string;
      name?: string | null;
    }>();

    type ContextType = typeof resolver._context;
    expectTypeOf<ContextType>().toEqualTypeOf<{
      input: {
        id: string;
        name?: string | null;
      };
    }>();

    expectTypeOf(resolver._output).toEqualTypeOf<never>();
  });

  it("fnStep追加後の型が正しいこと", () => {
    const _resolver = createQueryResolver("getUser", UserInput).fnStep(
      "fetchUser",
      async (context) => {
        type CtxType = typeof context;
        expectTypeOf<CtxType>().toEqualTypeOf<{
          input: {
            id: string;
            name?: string | null;
          };
        }>();

        return {
          id: context.input.id,
          name: "John Doe",
          email: "john@example.com",
        };
      },
    );

    type ResolverContext = typeof _resolver._context;
    expectTypeOf<ResolverContext>().toExtend<{
      input: {
        id: string;
        name?: string | null;
      };
      fetchUser: {
        id: string;
        name: string;
        email: string;
      };
    }>();
  });

  it("sqlStep追加後の型が正しいこと", () => {
    const _resolver = createQueryResolver("getUser", UserInput).sqlStep(
      "queryUser",
      ({ client, input }) => {
        return client.execOne<{ id: string; name: string; email: string }>(
          `SELECT * FROM users WHERE id = ${input.id}`,
        );
      },
    );

    // Result is added to context
    type ResolverContext = typeof _resolver._context;
    expectTypeOf<ResolverContext>().toExtend<{
      input: {
        id: string;
        name?: string | null;
      };
      queryUser: { id: string; name: string; email: string };
    }>();
  });

  it("gqlStep追加後の型が正しいこと", () => {
    const _resolver = createQueryResolver("getUser", UserInput).gqlStep(
      "fetchUserGql",
      ({ client, gql }) =>
        client.query(gql(`query { fetchUser { id name } }`), {}),
    );

    // The entire gql result is added to context
    type ResolverContext = typeof _resolver._context;
    type _t = ResolverContext["fetchUserGql"];
    expectTypeOf<ResolverContext>().toExtend<{
      input: {
        id: string;
        name?: string | null;
      };
      fetchUserGql: any; // Type of gql result
    }>();
  });

  it("returns()メソッドの型制約が正しいこと", () => {
    const _resolver = createQueryResolver("getUser", UserInput).fnStep(
      "fetchUser",
      async () => ({
        id: "1",
        name: "John",
        email: "john@example.com",
      }),
    );

    const _withReturns = _resolver.returns(
      (context) => ({
        id: context.fetchUser.id,
        name: context.fetchUser.name,
        email: context.fetchUser.email,
      }),
      UserOutput,
    );
    type OutputType = typeof _withReturns._output;
    expectTypeOf<OutputType>().toExtend<{
      id: string;
      name: string;
      email: string;
    }>();
  });

  it("複数のステップをチェーンした場合の型の累積が正しいこと", () => {
    const _resolver = createQueryResolver("complexQuery", UserInput)
      .fnStep("step1", async (context) => {
        type CtxType = typeof context;
        expectTypeOf<CtxType>().toExtend<{
          input: {
            id: string;
            name?: string | null;
          };
        }>();
        return { userId: context.input.id };
      })
      .sqlStep("step2", ({ client, step1 }) => {
        expectTypeOf<typeof step1>().toExtend<{ userId: string }>();

        return client.exec<{ posts: string[] }>(
          `SELECT posts FROM user_posts WHERE user_id = ${step1.userId}`,
        );
      })
      .gqlStep("step3", ({ gql: _gql, client, step2: _step2 }) => {
        expectTypeOf<typeof _step2>().toEqualTypeOf<{ posts: string[] }>();

        return client.query("" as any, {} as any);
      })
      .fnStep("step4", async (_context) => {
        type CtxType = typeof _context;
        expectTypeOf<CtxType>().toExtend<{
          input: {
            id: string;
            name?: string | null;
          };
          step1: { userId: string };
          step2: { posts: string[] };
          step3: any; // gql result
        }>();
        return {
          finalResult: "processed",
        };
      });

    // Type of the final context
    type FinalContext = typeof _resolver._context;
    expectTypeOf<FinalContext>().toExtend<{
      input: {
        id: string;
        name?: string | null;
      };
      step1: { userId: string };
      step2: { posts: string[] };
      step3: any; // gql result
      step4: { finalResult: string };
    }>();
  });

  it("createMutationResolverの型が正しいこと", () => {
    const resolver = createMutationResolver("updateUser", UserInput);
    expectTypeOf(resolver.queryType).toEqualTypeOf<"mutation">();
    expectTypeOf(resolver.name).toEqualTypeOf<string>();

    type InputType = typeof resolver._input;
    expectTypeOf<InputType>().toEqualTypeOf<{
      id: string;
      name?: string | null;
    }>();

    type ContextType = typeof resolver._context;
    expectTypeOf<ContextType>().toEqualTypeOf<{
      input: {
        id: string;
        name?: string | null;
      };
    }>();
  });

  it("CurrentOutputの型が各ステップで正しく更新されること", () => {
    const _resolver = createQueryResolver("test", UserInput)
      .fnStep("step1", () => ({ value: 1 }))
      .fnStep("step2", (_context) => {
        // context includes results from previous steps
        type CtxType = typeof _context;
        expectTypeOf<CtxType>().toExtend<{
          input: any;
          step1: { value: number };
        }>();
        return { value: "string" };
      })
      .sqlStep("step3", ({ step2: _step2 }) => {
        expectTypeOf<typeof _step2>().toExtend<{ value: string }>();
        return {} as Promise<{ sqlResult: boolean }>;
      })
      .gqlStep("step4", ({ step3: _step3 }) => {
        expectTypeOf<typeof _step3>().toEqualTypeOf<{ sqlResult: boolean }>();
        return {} as any;
      });

    // Verify that CurrentOutput is correctly typed for each step
    type FinalContext = typeof _resolver._context;
    expectTypeOf<FinalContext>().toExtend<{
      step1: { value: number };
      step2: { value: string };
      step3: { sqlResult: boolean };
      step4: any;
    }>();
  });

  it("オプショナルフィールドを含む型が正しく処理されること", () => {
    const OptionalInput = t.type({
      required: t.string(),
      optional: t.string({ optional: true }),
    });

    const _resolver = createQueryResolver("optionalTest", OptionalInput).fnStep(
      "processOptional",
      (_context) => {
        // Type check for optional fields
        type RequiredType = typeof _context.input.required;
        type OptionalType = typeof _context.input.optional;

        expectTypeOf<RequiredType>().toEqualTypeOf<string>();
        expectTypeOf<OptionalType>().toEqualTypeOf<string | null | undefined>();

        return { processed: true };
      },
    );

    type InputType = typeof _resolver._input;
    expectTypeOf<InputType>().toEqualTypeOf<{
      required: string;
      optional?: string | null;
    }>();
  });

  it("配列型を含む型が正しく処理されること", () => {
    const ArrayInput = t.type({
      ids: t.string({ array: true }),
      tags: t.string({ optional: true, array: true }),
    });

    const _resolver = createQueryResolver("arrayTest", ArrayInput).fnStep(
      "processArray",
      (_context) => {
        // Test for array types
        const ids = _context.input.ids;
        const tags = _context.input.tags;

        type IdsType = typeof ids;
        type TagsType = typeof tags;

        // Verify that they can be treated as array types
        expectTypeOf<IdsType>().toEqualTypeOf<string[]>();
        expectTypeOf<TagsType>().toEqualTypeOf<string[] | null | undefined>();

        // Verify that array operations are possible (runtime check)
        if (Array.isArray(ids)) {
          const count = ids.length;
          expectTypeOf(count).toEqualTypeOf<number>();
        }
        if (tags && Array.isArray(tags)) {
          const count = tags.length;
          expectTypeOf(count).toEqualTypeOf<number>();
        }

        return { count: Array.isArray(ids) ? ids.length : 0 };
      },
    );

    // Type verification
    type InputType = typeof _resolver._input;
    type ContextType = typeof _resolver._context;

    expectTypeOf<InputType>().toHaveProperty("ids");
    expectTypeOf<InputType>().toHaveProperty("tags");

    expectTypeOf<ContextType>().toHaveProperty("input");
    expectTypeOf<ContextType>().toHaveProperty("processArray");
  });

  it("ステップ間でのinputの型の変化が正しいこと", () => {
    const _resolver = createQueryResolver("stepInputTest", UserInput)
      .fnStep("step1", () => ({ result: "step1" }))
      .fnStep("step2", (_context) => {
        type ContextType = typeof _context;
        expectTypeOf<ContextType>().toExtend<{
          input: {
            id: string;
            name?: string | null | undefined;
          };
          step1: {
            result: string;
          };
        }>();

        expectTypeOf(_context.step1).toExtend<{ result: string }>();
        expectTypeOf(_context.step1.result).toExtend<string>();

        return { result: 123 };
      })
      .sqlStep("step3", ({ step2: _step2 }) => {
        expectTypeOf<typeof _step2>().toExtend<{ result: number }>();
        return {} as Promise<{ data: boolean[] }>;
      });

    type FinalContext = typeof _resolver._context;
    expectTypeOf<FinalContext>().toExtend<{
      input: {
        id: string;
        name?: string | null;
      };
      step1: { result: string };
      step2: { result: number };
      step3: { data: boolean[] };
    }>();
  });

  it("複雑な型の組み合わせが正しく処理されること", () => {
    const ComplexInput = t.type({
      id: t.string(),
      count: t.int(),
      price: t.float({ optional: true }),
      active: t.bool(),
      tags: t.string({ array: true }),
      data: t.string({ optional: true }), // Use string instead of json
    });

    const _resolver = createQueryResolver("complexTest", ComplexInput).fnStep(
      "processComplex",
      (context) => {
        expectTypeOf(context.input.id).toEqualTypeOf<string>();
        expectTypeOf(context.input.count).toEqualTypeOf<number>();
        expectTypeOf(context.input.price).toEqualTypeOf<
          number | null | undefined
        >();
        expectTypeOf(context.input.active).toEqualTypeOf<boolean>();
        expectTypeOf(context.input.tags).toEqualTypeOf<string[]>();
        expectTypeOf(context.input.data).toEqualTypeOf<
          string | null | undefined
        >();

        type ContextType = typeof context;
        expectTypeOf<ContextType>().toEqualTypeOf<{
          input: {
            id: string;
            count: number;
            price?: number | null | undefined;
            active: boolean;
            tags: string[];
            data?: string | null | undefined;
          };
        }>();

        return {
          result: `Processed ${context.input.id}`,
          itemCount: context.input.count,
        };
      },
    );

    type InputType = typeof _resolver._input;
    type ContextType = typeof _resolver._context;

    expectTypeOf<InputType>().toHaveProperty("id");
    expectTypeOf<InputType>().toHaveProperty("count");
    expectTypeOf<InputType>().toHaveProperty("price");
    expectTypeOf<InputType>().toHaveProperty("active");
    expectTypeOf<InputType>().toHaveProperty("tags");
    expectTypeOf<InputType>().toHaveProperty("data");

    expectTypeOf<ContextType>().toHaveProperty("input");
    expectTypeOf<ContextType>().toHaveProperty("processComplex");
  });

  it("enum型を含む場合の型が正しいこと", () => {
    const EnumInput = t.type({
      status: t.enum("active", "inactive", "pending"),
      priority: t.enum("low", "medium", "high", { optional: true }),
    });

    const _resolver = createQueryResolver("enumTest", EnumInput).fnStep(
      "processEnum",
      (_context) => {
        // Type check for enum values
        expectTypeOf(_context.input.status).toEqualTypeOf<
          "active" | "inactive" | "pending"
        >();
        expectTypeOf(_context.input.priority).toEqualTypeOf<
          "low" | "medium" | "high" | null | undefined
        >();

        // Verify the type of the entire context
        type ContextType = typeof _context;
        expectTypeOf<ContextType>().toEqualTypeOf<{
          input: {
            status: "active" | "inactive" | "pending";
            priority?: "low" | "medium" | "high" | null;
          };
        }>();

        return { processed: true };
      },
    );

    type InputType = typeof _resolver._input;

    // Verify that the input type is correct
    expectTypeOf<InputType>().toEqualTypeOf<{
      status: "active" | "inactive" | "pending";
      priority?: "low" | "medium" | "high" | null;
    }>();

    // Verify the type with actual values
    const testInput: InputType = {
      status: "active",
      priority: "medium",
    };
    const testInputWithoutPriority: InputType = {
      status: "inactive",
    };

    expectTypeOf(testInput).toEqualTypeOf<InputType>();
    expectTypeOf(testInputWithoutPriority).toEqualTypeOf<InputType>();
  });

  it("ネストした型構造の処理が正しいこと", () => {
    // Nested type definition (represented as flat structure because TailorType cannot be used as a field)
    const NestedInput = t.type({
      userId: t.string(),
      userName: t.string(),
      profileName: t.string(),
      profileAge: t.int({ optional: true }),
      tags: t.string({ array: true }),
    });

    const _resolver = createQueryResolver("nestedTest", NestedInput).fnStep(
      "processNested",
      (_context) => {
        // Verify the type of each field
        expectTypeOf(_context.input.userId).toEqualTypeOf<string>();
        expectTypeOf(_context.input.userName).toEqualTypeOf<string>();
        expectTypeOf(_context.input.profileName).toEqualTypeOf<string>();
        expectTypeOf(_context.input.profileAge).toEqualTypeOf<
          number | null | undefined
        >();
        expectTypeOf(_context.input.tags).toEqualTypeOf<string[]>();

        return { processed: true };
      },
    );

    // Type verification
    type InputType = typeof _resolver._input;
    type ContextType = typeof _resolver._context;

    // Verify complete type definition
    // Verify property existence
    expectTypeOf<InputType>().toHaveProperty("userId");
    expectTypeOf<InputType>().toHaveProperty("userName");
    expectTypeOf<InputType>().toHaveProperty("profileName");
    expectTypeOf<InputType>().toHaveProperty("profileAge");
    expectTypeOf<InputType>().toHaveProperty("tags");

    expectTypeOf<ContextType>().toHaveProperty("input");
    expectTypeOf<ContextType>().toHaveProperty("processNested");
  });
});
