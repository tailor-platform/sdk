import { describe, expectTypeOf, it } from "vitest";
import { createMutationResolver, createQueryResolver } from "./resolver";
import { t } from "@/types/type";
import type { TailorUser } from "@/types";

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
    expectTypeOf(resolver.name).toEqualTypeOf<string>();

    type ContextType = typeof resolver._context;
    expectTypeOf<ContextType>().toExtend<{
      input: {
        id: string;
        name?: string | null;
      };
    }>();
  });

  it("fnStep追加後の型が正しいこと", () => {
    const _resolver = createQueryResolver("getUser", UserInput).fnStep(
      "fetchUser",
      async (context) => {
        type CtxType = typeof context;
        expectTypeOf<CtxType>().toExtend<{
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

  it("fnStepでJsonValueを返した場合にエラーにならないこと", () => {
    const a = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => ({ key: "value" }),
    );
    expectTypeOf(a._context).toExtend<{
      validStep: {
        key: string;
      };
    }>();

    const b = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => "value",
    );
    expectTypeOf(b._context).toExtend<{
      validStep: string;
    }>();

    const c = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => 10,
    );
    expectTypeOf(c._context).toExtend<{
      validStep: number;
    }>();

    const d = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => true,
    );
    expectTypeOf(d._context).toExtend<{
      validStep: boolean;
    }>();

    const e = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => [1, 2, 3],
    );
    expectTypeOf(e._context).toExtend<{
      validStep: number[];
    }>();

    const f = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => null,
    );
    expectTypeOf(f._context).toExtend<{
      validStep: null;
    }>();

    const g = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => undefined,
    );
    expectTypeOf(g._context).toExtend<{
      validStep: null;
    }>();

    const h = createQueryResolver("getUser", UserInput).fnStep(
      "validStep",
      () => {},
    );
    expectTypeOf(h._context).toExtend<{
      validStep: null;
    }>();
  });

  it("fnStepでJsonValueでない型を返した場合にエラーになること", () => {
    // @ts-expect-error Date cannot be used as return type
    createQueryResolver("getUser", UserInput).fnStep("invalidStep", () => {
      return new Date();
    });

    // @ts-expect-error Function cannot be used as return type
    createQueryResolver("getUser", UserInput).fnStep("invalidStep", () => {
      return () => {};
    });
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
      .fnStep(
        "step2",
        ({ client, step1 }) => {
          expectTypeOf<typeof step1>().toExtend<{ userId: string }>();

          return client.exec<{ posts: string[] }>(
            `SELECT posts FROM user_posts WHERE user_id = ${step1.userId}`,
          );
        },
        { dbNamespace: "main-db" },
      )
      .fnStep("step3", async (_context) => {
        type CtxType = typeof _context;
        expectTypeOf<CtxType>().toExtend<{
          input: {
            id: string;
            name?: string | null;
          };
          step1: { userId: string };
          step2: { posts: string[] };
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
      step3: { finalResult: string };
    }>();
  });

  it("createMutationResolverの型が正しいこと", () => {
    const resolver = createMutationResolver("updateUser", UserInput);
    expectTypeOf(resolver.name).toEqualTypeOf<string>();

    type ContextType = typeof resolver._context;
    expectTypeOf<ContextType>().toExtend<{
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
      .fnStep("step3", ({ step2: _step2 }) => {
        expectTypeOf<typeof _step2>().toExtend<{ value: string }>();
        return {} as Promise<{ sqlResult: boolean }>;
      });

    // Verify that CurrentOutput is correctly typed for each step
    type FinalContext = typeof _resolver._context;
    expectTypeOf<FinalContext>().toExtend<{
      step1: { value: number };
      step2: { value: string };
      step3: { sqlResult: boolean };
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

    // 型の確認
    type ContextType = typeof _resolver._context;
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
      .fnStep("step3", ({ step2: _step2 }) => {
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
        expectTypeOf<ContextType>().toExtend<{
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

    type ContextType = typeof _resolver._context;
    expectTypeOf<ContextType>().toHaveProperty("input");
    expectTypeOf<ContextType>().toHaveProperty("processComplex");
  });

  it("enum型を含む場合の型が正しいこと", () => {
    const EnumInput = t.type({
      status: t.enum("active", "inactive", "pending"),
      priority: t.enum("low", "medium", "high", { optional: true }),
    });

    createQueryResolver("enumTest", EnumInput).fnStep(
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
        expectTypeOf<ContextType>().toExtend<{
          input: {
            status: "active" | "inactive" | "pending";
            priority?: "low" | "medium" | "high" | null;
          };
        }>();

        return { processed: true };
      },
    );
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

    // 型の確認
    type ContextType = typeof _resolver._context;
    expectTypeOf<ContextType>().toHaveProperty("input");
    expectTypeOf<ContextType>().toHaveProperty("processNested");
  });

  it("context に user が含まれること", () => {
    const r1 = createQueryResolver(
      "withUser",
      t.type({
        message: t.string(),
      }),
    ).fnStep("step1", (context) => {
      return "Hello, " + context.user.id;
    });
    expectTypeOf(r1._context).toExtend<{
      user: TailorUser;
    }>();

    const r2 = createMutationResolver(
      "withUser",
      t.type({
        message: t.string(),
      }),
    ).fnStep("step1", (context) => {
      return "Hello, " + context.user.id;
    });
    expectTypeOf(r2._context).toExtend<{
      user: TailorUser;
    }>();
  });
});
