import { describe, expectTypeOf, test, expect } from "vitest";
import { createResolver } from "./resolver";
import { t } from "@/configure/types";
import type { output } from "@/configure/types/helpers";
import type { TailorUser } from "@/configure/types/user";
import type { SqlClient } from "./sql";

describe("createResolver", () => {
  describe("type inference", () => {
    test("query resolver without input has correct context type", () => {
      createResolver({
        name: "noInput",
        operation: "query",
        output: t.type({
          result: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context).toHaveProperty("client");
          expectTypeOf(context).not.toHaveProperty("input");
          expectTypeOf(context.user).toMatchTypeOf<TailorUser>();
          expectTypeOf(context.client).toMatchTypeOf<SqlClient>();
          return { result: "hello" };
        },
      });
    });

    test("mutation resolver without input has correct context type", () => {
      createResolver({
        name: "noInput",
        operation: "mutation",
        output: t.type({
          success: t.bool(),
        }),
        body: (context) => {
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context).toHaveProperty("client");
          expectTypeOf(context).not.toHaveProperty("input");
          expectTypeOf(context.user).toMatchTypeOf<TailorUser>();
          expectTypeOf(context.client).toMatchTypeOf<SqlClient>();
          return { success: true };
        },
      });
    });

    test("resolver with simple input has correct context type", () => {
      const inputType = t.type({
        name: t.string(),
        age: t.int(),
      });

      createResolver({
        name: "withInput",
        operation: "query",
        input: inputType,
        output: t.type({
          message: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context).toHaveProperty("client");
          expectTypeOf(context.input).toMatchTypeOf<{
            name: string;
            age: number;
          }>();
          return { message: `Hello ${context.input.name}` };
        },
      });
    });

    test("resolver with optional fields", () => {
      const inputType = t.type({
        required: t.string(),
        optional: t.string({ optional: true }),
      });

      createResolver({
        name: "optionalFields",
        operation: "query",
        input: inputType,
        output: t.type({
          result: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.required).toBeString();
          expectTypeOf(context.input.optional).toMatchTypeOf<
            string | null | undefined
          >();
          return { result: context.input.required };
        },
      });
    });

    test("resolver with array fields", () => {
      const inputType = t.type({
        items: t.string({ array: true }),
        numbers: t.int({ array: true }),
      });

      createResolver({
        name: "arrayFields",
        operation: "mutation",
        input: inputType,
        output: t.type({
          count: t.int(),
        }),
        body: (context) => {
          expectTypeOf(context.input.items).toBeArray();
          expectTypeOf(context.input.numbers).toBeArray();
          return { count: context.input.items.length };
        },
      });
    });

    test("resolver with enum fields", () => {
      const inputType = t.type({
        role: t.enum("ADMIN", "USER"),
        status: t.enum("ACTIVE", "INACTIVE", { optional: true }),
      });

      createResolver({
        name: "enumFields",
        operation: "query",
        input: inputType,
        output: t.type({
          message: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.role).toMatchTypeOf<"ADMIN" | "USER">();
          expectTypeOf(context.input.status).toMatchTypeOf<
            "ACTIVE" | "INACTIVE" | null | undefined
          >();
          return { message: `Role: ${context.input.role}` };
        },
      });
    });

    test("resolver with nested objects", () => {
      const inputType = t.type({
        user: t.object({
          name: t.object({
            first: t.string(),
            last: t.string(),
          }),
          age: t.int({ optional: true }),
        }),
      });

      createResolver({
        name: "nestedObjects",
        operation: "query",
        input: inputType,
        output: t.type({
          fullName: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.user.name.first).toBeString();
          expectTypeOf(context.input.user.name.last).toBeString();
          expectTypeOf(context.input.user.age).toMatchTypeOf<
            number | null | undefined
          >();
          return {
            fullName: `${context.input.user.name.first} ${context.input.user.name.last}`,
          };
        },
      });
    });

    test("resolver with mixed types", () => {
      const inputType = t.type({
        id: t.uuid(),
        name: t.string(),
        active: t.bool(),
        count: t.int(),
        score: t.float(),
        createdAt: t.datetime(),
        tags: t.string({ array: true }),
        metadata: t.object({
          key: t.string(),
          value: t.string({ optional: true }),
        }),
      });

      createResolver({
        name: "mixedTypes",
        operation: "mutation",
        input: inputType,
        output: t.type({
          success: t.bool(),
        }),
        body: (context) => {
          expectTypeOf(context.input.id).toBeString();
          expectTypeOf(context.input.name).toBeString();
          expectTypeOf(context.input.active).toBeBoolean();
          expectTypeOf(context.input.count).toBeNumber();
          expectTypeOf(context.input.score).toBeNumber();
          expectTypeOf(context.input.createdAt).toMatchTypeOf<Date | string>();
          expectTypeOf(context.input.tags).toBeArray();
          expectTypeOf(context.input.metadata.key).toBeString();
          return { success: true };
        },
      });
    });

    test("resolver output type inference", () => {
      const outputType = t.type({
        id: t.string(),
        items: t.object(
          {
            name: t.string(),
            count: t.int(),
          },
          { array: true },
        ),
      });

      createResolver({
        name: "outputTypes",
        operation: "query",
        output: outputType,
        body: (_context) => {
          const result = {
            id: "123",
            items: [
              { name: "item1", count: 5 },
              { name: "item2", count: 10 },
            ],
          };
          expectTypeOf(result).toMatchTypeOf<output<typeof outputType>>();
          return result;
        },
      });
    });

    test("async resolver body", () => {
      createResolver({
        name: "asyncResolver",
        operation: "query",
        input: t.type({
          id: t.string(),
        }),
        output: t.type({
          data: t.string(),
        }),
        body: async (context) => {
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context).toHaveProperty("client");
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { data: context.input.id };
        },
      });
    });

    test("resolver with dbNamespace option", () => {
      createResolver({
        name: "withDbNamespace",
        operation: "mutation",
        input: t.type({
          name: t.string(),
        }),
        output: t.type({
          success: t.bool(),
        }),
        options: {
          dbNamespace: "main-db",
        },
        body: async (context) => {
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context).toHaveProperty("client");
          expectTypeOf(context.client).toMatchTypeOf<SqlClient>();
          return { success: true };
        },
      });
    });

    test("user context always available", () => {
      createResolver({
        name: "withUser",
        operation: "query",
        output: t.type({
          userId: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.user).toMatchTypeOf<TailorUser>();
          expectTypeOf(context.user.id).toBeString();
          expectTypeOf(context.user.type).toBeString();
          expectTypeOf(context.user.workspaceId).toBeString();
          return { userId: context.user.id };
        },
      });
    });

    test("complex nested structure", () => {
      const inputType = t.type({
        orders: t.object(
          {
            id: t.string(),
            items: t.object(
              {
                productId: t.string(),
                quantity: t.int(),
                metadata: t.object({
                  tags: t.string({ array: true }),
                  notes: t.string({ optional: true }),
                }),
              },
              { array: true },
            ),
            status: t.enum("PENDING", "COMPLETED", "CANCELLED"),
          },
          { array: true },
        ),
      });

      createResolver({
        name: "complexNested",
        operation: "mutation",
        input: inputType,
        output: t.type({
          processed: t.int(),
        }),
        body: (context) => {
          expectTypeOf(context.input.orders).toBeArray();
          expectTypeOf(context.input.orders[0]?.id).toMatchTypeOf<
            string | undefined
          >();
          return { processed: context.input.orders.length };
        },
      });
    });

    test("all basic types", () => {
      const inputType = t.type({
        uuid: t.uuid(),
        string: t.string(),
        bool: t.bool(),
        int: t.int(),
        float: t.float(),
        date: t.date(),
        datetime: t.datetime(),
        time: t.time(),
      });

      createResolver({
        name: "allBasicTypes",
        operation: "query",
        input: inputType,
        output: t.type({
          summary: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.uuid).toBeString();
          expectTypeOf(context.input.string).toBeString();
          expectTypeOf(context.input.bool).toBeBoolean();
          expectTypeOf(context.input.int).toBeNumber();
          expectTypeOf(context.input.float).toBeNumber();
          expectTypeOf(context.input.date).toMatchTypeOf<Date | string>();
          expectTypeOf(context.input.datetime).toMatchTypeOf<Date | string>();
          expectTypeOf(context.input.time).toBeString();
          return { summary: "ok" };
        },
      });
    });

    test("enum with array", () => {
      const inputType = t.type({
        roles: t.enum("ADMIN", "USER", "GUEST", { array: true }),
      });

      createResolver({
        name: "enumArray",
        operation: "query",
        input: inputType,
        output: t.type({
          count: t.int(),
        }),
        body: (context) => {
          expectTypeOf(context.input.roles).toBeArray();
          return { count: context.input.roles.length };
        },
      });
    });

    test("operation type is correct", () => {
      const queryResolver = createResolver({
        name: "query",
        operation: "query",
        output: t.type({ result: t.string() }),
        body: (_context) => ({ result: "ok" }),
      });

      const mutationResolver = createResolver({
        name: "mutation",
        operation: "mutation",
        output: t.type({ success: t.bool() }),
        body: (_context) => ({ success: true }),
      });

      expectTypeOf(queryResolver.operation).toBeString();
      expectTypeOf(mutationResolver.operation).toBeString();
    });

    test("resolver name is preserved", () => {
      const resolver = createResolver({
        name: "testResolver",
        operation: "query",
        output: t.type({ result: t.string() }),
        body: (_context) => ({ result: "ok" }),
      });

      expectTypeOf(resolver.name).toBeString();
    });

    test("output type matches return type", () => {
      const outputType = t.type({
        id: t.string(),
        count: t.int(),
        active: t.bool(),
      });

      createResolver({
        name: "outputMatch",
        operation: "query",
        output: outputType,
        body: (_context) => {
          const result = {
            id: "123",
            count: 42,
            active: true,
          };
          expectTypeOf(result).toEqualTypeOf<output<typeof outputType>>();
          return result;
        },
      });
    });

    test("optional nested objects", () => {
      const inputType = t.type({
        config: t.object(
          {
            setting1: t.string(),
            setting2: t.int({ optional: true }),
          },
          { optional: true },
        ),
      });

      createResolver({
        name: "optionalNested",
        operation: "query",
        input: inputType,
        output: t.type({ hasConfig: t.bool() }),
        body: (context) => {
          expectTypeOf(context.input.config).toEqualTypeOf<
            | {
                setting1: string;
                setting2?: number | null;
              }
            | null
            | undefined
          >();
          return { hasConfig: !!context.input.config };
        },
      });
    });
  });

  describe("runtime values", () => {
    test("creates resolver with all properties", () => {
      const inputType = t.type({
        name: t.string(),
        age: t.int(),
      });

      const outputType = t.type({
        message: t.string(),
      });

      const resolver = createResolver({
        name: "testResolver",
        description: "A test resolver",
        operation: "query",
        input: inputType,
        output: outputType,
        options: {
          dbNamespace: "test-db",
        },
        body: (context) => ({
          message: `Hello ${context.input.name}`,
        }),
      });

      expect(resolver.name).toBe("testResolver");
      expect(resolver.description).toBe("A test resolver");
      expect(resolver.operation).toBe("query");
      expect(resolver.input).toBe(inputType);
      expect(resolver.output).toBe(outputType);
      expect(resolver.options?.dbNamespace).toBe("test-db");
      expect(typeof resolver.body).toBe("function");
    });

    test("creates minimal resolver without optional fields", () => {
      const outputType = t.type({
        result: t.string(),
      });

      const resolver = createResolver({
        name: "minimal",
        operation: "mutation",
        output: outputType,
        body: () => ({ result: "done" }),
      });

      expect(resolver.name).toBe("minimal");
      expect(resolver.operation).toBe("mutation");
      expect(resolver.output).toBe(outputType);
      expect(resolver.description).toBeUndefined();
      expect(resolver.input).toBeUndefined();
      expect(resolver.options).toBeUndefined();
    });

    test("creates query resolver", () => {
      const resolver = createResolver({
        name: "getUser",
        operation: "query",
        output: t.type({ id: t.string() }),
        body: () => ({ id: "123" }),
      });

      expect(resolver.operation).toBe("query");
    });

    test("creates mutation resolver", () => {
      const resolver = createResolver({
        name: "createUser",
        operation: "mutation",
        output: t.type({ success: t.bool() }),
        body: () => ({ success: true }),
      });

      expect(resolver.operation).toBe("mutation");
    });

    test("preserves input and output types", () => {
      const inputType = t.type({
        email: t.string(),
      });

      const outputType = t.type({
        userId: t.string(),
      });

      const resolver = createResolver({
        name: "register",
        operation: "mutation",
        input: inputType,
        output: outputType,
        body: (context) => ({ userId: context.input.email }),
      });

      expect(resolver.input).toBe(inputType);
      expect(resolver.output).toBe(outputType);
    });

    test("preserves options", () => {
      const resolver = createResolver({
        name: "dbQuery",
        operation: "query",
        output: t.type({ count: t.int() }),
        options: {
          dbNamespace: "analytics",
        },
        body: () => ({ count: 42 }),
      });

      expect(resolver.options).toEqual({ dbNamespace: "analytics" });
    });
  });
});
