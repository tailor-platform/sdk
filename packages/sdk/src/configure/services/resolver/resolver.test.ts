import { describe, expectTypeOf, test, expect } from "vitest";
import { db } from "@/configure/services/tailordb";
import { t } from "@/configure/types";
import { createResolver } from "./resolver";
import type { output } from "@/configure/types/helpers";
import type { TailorUser } from "@/configure/types/user";
import type { ResolverInput } from "@/types/resolver.generated";

describe("createResolver", () => {
  describe("type inference", () => {
    test("query resolver without input has correct context type", () => {
      createResolver({
        name: "noInput",
        operation: "query",
        output: t.object({
          result: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context.user).toEqualTypeOf<TailorUser>();
          expectTypeOf(context.input).toBeNever();
          return { result: "hello" };
        },
      });
    });

    test("mutation resolver without input has correct context type", () => {
      createResolver({
        name: "noInput",
        operation: "mutation",
        output: t.object({
          success: t.bool(),
        }),
        body: (context) => {
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context.user).toEqualTypeOf<TailorUser>();
          expectTypeOf(context.input).toBeNever();
          return { success: true };
        },
      });
    });

    test("resolver with simple input has correct context type", () => {
      const inputType = {
        name: t.string(),
        age: t.int(),
      };

      createResolver({
        name: "withInput",
        operation: "query",
        input: inputType,
        output: t.object({
          message: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context).toHaveProperty("user");
          expectTypeOf(context.input).toEqualTypeOf<{
            name: string;
            age: number;
          }>();
          return { message: `Hello ${context.input.name}` };
        },
      });
    });

    test("resolver with optional fields", () => {
      const inputType = {
        required: t.string(),
        optional: t.string({ optional: true }),
      };

      createResolver({
        name: "optionalFields",
        operation: "query",
        input: inputType,
        output: t.object({
          result: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.required).toBeString();
          expectTypeOf(context.input.optional).toEqualTypeOf<string | null | undefined>();
          return { result: context.input.required };
        },
      });
    });

    test("resolver with array fields", () => {
      const inputType = {
        items: t.string({ array: true }),
        numbers: t.int({ array: true }),
      };

      createResolver({
        name: "arrayFields",
        operation: "mutation",
        input: inputType,
        output: t.object({
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
      const inputType = {
        role: t.enum(["ADMIN", "USER"]),
        status: t.enum(["ACTIVE", "INACTIVE"], { optional: true }),
      };

      createResolver({
        name: "enumFields",
        operation: "query",
        input: inputType,
        output: t.object({
          message: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.role).toEqualTypeOf<"ADMIN" | "USER">();
          expectTypeOf(context.input.status).toEqualTypeOf<
            "ACTIVE" | "INACTIVE" | null | undefined
          >();
          return { message: `Role: ${context.input.role}` };
        },
      });
    });

    test("resolver with nested objects", () => {
      const inputType = {
        user: t.object({
          name: t.object({
            first: t.string(),
            last: t.string(),
          }),
          age: t.int({ optional: true }),
        }),
      };

      createResolver({
        name: "nestedObjects",
        operation: "query",
        input: inputType,
        output: t.object({
          fullName: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.user.name.first).toBeString();
          expectTypeOf(context.input.user.name.last).toBeString();
          expectTypeOf(context.input.user.age).toEqualTypeOf<number | null | undefined>();
          return {
            fullName: `${context.input.user.name.first} ${context.input.user.name.last}`,
          };
        },
      });
    });

    test("resolver with mixed types", () => {
      const inputType = {
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
      };

      createResolver({
        name: "mixedTypes",
        operation: "mutation",
        input: inputType,
        output: t.object({
          success: t.bool(),
        }),
        body: (context) => {
          expectTypeOf(context.input.id).toBeString();
          expectTypeOf(context.input.name).toBeString();
          expectTypeOf(context.input.active).toBeBoolean();
          expectTypeOf(context.input.count).toBeNumber();
          expectTypeOf(context.input.score).toBeNumber();
          expectTypeOf(context.input.createdAt).toExtend<Date | string>();
          expectTypeOf(context.input.tags).toBeArray();
          expectTypeOf(context.input.metadata.key).toBeString();
          return { success: true };
        },
      });
    });

    test("resolver output type inference", () => {
      const outputType = t.object({
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
          expectTypeOf(result).toEqualTypeOf<output<typeof outputType>>();
          return result;
        },
      });
    });

    test("async resolver body", () => {
      createResolver({
        name: "asyncResolver",
        operation: "query",
        input: {
          id: t.string(),
        },
        output: t.object({
          data: t.string(),
        }),
        body: async (context) => {
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context).toHaveProperty("user");
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { data: context.input.id };
        },
      });
    });

    test("resolver with dbNamespace option", () => {
      createResolver({
        name: "withDbNamespace",
        operation: "mutation",
        input: {
          name: t.string(),
        },
        output: t.object({
          success: t.bool(),
        }),
        body: async (context) => {
          expectTypeOf(context).toHaveProperty("input");
          expectTypeOf(context).toHaveProperty("user");
          return { success: true };
        },
      });
    });

    test("user context always available", () => {
      createResolver({
        name: "withUser",
        operation: "query",
        output: t.object({
          userId: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.user).toEqualTypeOf<TailorUser>();
          expectTypeOf(context.user.id).toBeString();
          expectTypeOf(context.user.type).toBeString();
          expectTypeOf(context.user.workspaceId).toBeString();
          return { userId: context.user.id };
        },
      });
    });

    test("complex nested structure", () => {
      const inputType = {
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
            status: t.enum(["PENDING", "COMPLETED", "CANCELLED"]),
          },
          { array: true },
        ),
      };

      createResolver({
        name: "complexNested",
        operation: "mutation",
        input: inputType,
        output: t.object({
          processed: t.int(),
        }),
        body: (context) => {
          expectTypeOf(context.input.orders).toBeArray();
          expectTypeOf(context.input.orders[0]?.id).toExtend<string | undefined>();
          return { processed: context.input.orders.length };
        },
      });
    });

    test("all basic types", () => {
      const inputType = {
        uuid: t.uuid(),
        string: t.string(),
        bool: t.bool(),
        int: t.int(),
        float: t.float(),
        date: t.date(),
        datetime: t.datetime(),
        time: t.time(),
      };

      createResolver({
        name: "allBasicTypes",
        operation: "query",
        input: inputType,
        output: t.object({
          summary: t.string(),
        }),
        body: (context) => {
          expectTypeOf(context.input.uuid).toBeString();
          expectTypeOf(context.input.string).toBeString();
          expectTypeOf(context.input.bool).toBeBoolean();
          expectTypeOf(context.input.int).toBeNumber();
          expectTypeOf(context.input.float).toBeNumber();
          expectTypeOf(context.input.date).toExtend<Date | string>();
          expectTypeOf(context.input.datetime).toExtend<Date | string>();
          expectTypeOf(context.input.time).toBeString();
          return { summary: "ok" };
        },
      });
    });

    test("enum with array", () => {
      const inputType = {
        roles: t.enum(["ADMIN", "USER", "GUEST"], { array: true }),
      };

      createResolver({
        name: "enumArray",
        operation: "query",
        input: inputType,
        output: t.object({
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
        output: t.object({ result: t.string() }),
        body: (_context) => ({ result: "ok" }),
      });

      const mutationResolver = createResolver({
        name: "mutation",
        operation: "mutation",
        output: t.object({ success: t.bool() }),
        body: (_context) => ({ success: true }),
      });

      expectTypeOf(queryResolver.operation).toBeString();
      expectTypeOf(mutationResolver.operation).toBeString();
    });

    test("resolver name is preserved", () => {
      const resolver = createResolver({
        name: "testResolver",
        operation: "query",
        output: t.object({ result: t.string() }),
        body: (_context) => ({ result: "ok" }),
      });

      expectTypeOf(resolver.name).toBeString();
    });

    test("output type matches return type", () => {
      const outputType = t.object({
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
      const inputType = {
        config: t.object(
          {
            setting1: t.string(),
            setting2: t.int({ optional: true }),
          },
          { optional: true },
        ),
      };

      createResolver({
        name: "optionalNested",
        operation: "query",
        input: inputType,
        output: t.object({ hasConfig: t.bool() }),
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
      const inputType = {
        name: t.string(),
        age: t.int(),
      };

      const outputType = t.object({
        message: t.string(),
      });

      const resolver = createResolver({
        name: "testResolver",
        description: "A test resolver",
        operation: "query",
        input: inputType,
        output: outputType,
        body: (context) => ({
          message: `Hello ${context.input.name}`,
        }),
      });

      expect(resolver.name).toBe("testResolver");
      expect(resolver.description).toBe("A test resolver");
      expect(resolver.operation).toBe("query");
      expect(resolver.input).toBe(inputType);
      expect(resolver.output).toBe(outputType);
      expect(typeof resolver.body).toBe("function");
    });

    test("creates resolver with authInvoker", () => {
      const outputType = t.object({
        result: t.string(),
      });

      const resolver = createResolver({
        name: "withAuthInvoker",
        operation: "query",
        output: outputType,
        body: () => ({ result: "ok" }),
        authInvoker: { namespace: "my-auth", machineUserName: "batch-user" },
      });

      expect(resolver.name).toBe("withAuthInvoker");
      expect(resolver.authInvoker).toEqual({
        namespace: "my-auth",
        machineUserName: "batch-user",
      });
    });

    test("creates minimal resolver without optional fields", () => {
      const outputType = t.object({
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
    });

    test("accepts Record<string, TailorField> as output and converts to t.object()", () => {
      const resolver = createResolver({
        name: "recordOutput",
        operation: "query",
        output: {
          name: t.string(),
          age: t.int(),
        },
        body: () => ({ name: "John", age: 30 }),
      });

      // Verify the output was converted to t.object()
      expect(resolver.output.type).toBe("nested");
      expect(resolver.output.fields).toBeDefined();
      expect(resolver.output.fields.name.type).toBe("string");
      expect(resolver.output.fields.age.type).toBe("integer");
    });
  });

  describe("description support", () => {
    test("Output field supports description", () => {
      const inputType = {
        name: t.string(),
      };

      const outputType = t
        .object({
          result: t.string(),
        })
        .description("Output type description");

      const resolver = createResolver({
        name: "withDescriptions",
        operation: "query",
        input: inputType,
        output: outputType,
        body: (context) => ({ result: context.input.name }),
      });

      expect(resolver.output.metadata.description).toBe("Output type description");
    });

    test("TailorDBType field descriptions are preserved in resolver", () => {
      const userFields = {
        name: db.string().description("User name"),
        email: db.string().description("User email"),
      };

      const resolver = createResolver({
        name: "getUserInfo",
        operation: "query",
        input: userFields,
        output: t.object(userFields).description("User database type"),
        body: (context) => context.input,
      });

      expect(resolver.output.metadata.description).toBe("User database type");
      expect(resolver.input?.name.metadata.description).toBe("User name");
      expect(resolver.input?.email.metadata.description).toBe("User email");
    });

    test("TailorField supports description", () => {
      const inputType = {
        name: t.string().description("User name field"),
        age: t.int().description("User age field"),
      };

      const resolver = createResolver({
        name: "withFieldDescriptions",
        operation: "query",
        input: inputType,
        output: t.object({
          result: t.string().description("Result message"),
        }),
        body: (context) => ({ result: `${context.input.name}` }),
      });

      expect(resolver.input?.name.metadata.description).toBe("User name field");
      expect(resolver.input?.age.metadata.description).toBe("User age field");
      expect(resolver.output.fields.result.metadata.description).toBe("Result message");
    });

    test("nested object field supports description", () => {
      const inputType = {
        user: t
          .object({
            name: t.string().description("Name field"),
            age: t.int().description("Age field"),
          })
          .description("User object field"),
      };

      const resolver = createResolver({
        name: "withNestedDescriptions",
        operation: "query",
        input: inputType,
        output: t.object({
          result: t.string(),
        }),
        body: (context) => ({ result: context.input.user.name }),
      });

      expect(resolver.input?.user.metadata.description).toBe("User object field");
      expect(resolver.input?.user.fields.name.metadata.description).toBe("Name field");
      expect(resolver.input?.user.fields.age.metadata.description).toBe("Age field");
    });
  });

  describe("type compatibility with ResolverInput", () => {
    test("createResolver output is compatible with ResolverInput", () => {
      const resolver = createResolver({
        name: "compatTest",
        description: "Test compatibility",
        operation: "query",
        input: {
          id: t.string(),
        },
        output: t.object({
          result: t.string(),
        }),
        body: (context) => ({ result: context.input.id }),
      });

      // Verify that the resolver object is compatible with ResolverInput
      expectTypeOf(resolver).toExtend<ResolverInput>();
    });

    test("all ResolverInput fields (except input/output) are supported in createResolver config", () => {
      // Test that all fields from ResolverInput (except input/output which have different types)
      // can be used in createResolver config

      const resolver = createResolver({
        // Required fields
        name: "fullConfigTest",
        operation: "mutation",
        output: t.object({ success: t.bool() }),
        body: () => ({ success: true }),

        // Optional fields from ResolverInput
        description: "Full configuration test",
      });

      // Verify that all expected fields are present
      expect(resolver.name).toBe("fullConfigTest");
      expect(resolver.operation).toBe("mutation");
      expect(resolver.description).toBe("Full configuration test");
      expectTypeOf(resolver).toExtend<ResolverInput>();
    });

    test("createResolver with input/output types is compatible with ResolverInput", () => {
      const inputType = {
        userId: t.string(),
        data: t.object({
          key: t.string(),
          value: t.int(),
        }),
      };

      const outputType = t.object({
        processed: t.bool(),
        result: t.object({
          count: t.int(),
          items: t.string({ array: true }),
        }),
      });

      const resolver = createResolver({
        name: "typeCompatTest",
        description: "Type compatibility test",
        operation: "query",
        input: inputType,
        output: outputType,
        body: (context) => ({
          processed: true,
          result: {
            count: 1,
            items: [context.input.userId],
          },
        }),
      });

      // The resolver should be assignable to ResolverInput
      expectTypeOf(resolver).toExtend<ResolverInput>();

      // Verify runtime values
      expect(resolver.name).toBe("typeCompatTest");
      expect(resolver.description).toBe("Type compatibility test");
      expect(resolver.operation).toBe("query");
      expect(resolver.input).toBe(inputType);
      expect(resolver.output).toBe(outputType);
    });

    test("minimal createResolver config is compatible with ResolverInput", () => {
      const resolver = createResolver({
        name: "minimalCompat",
        operation: "query",
        output: t.object({ value: t.string() }),
        body: () => ({ value: "test" }),
      });

      // Even minimal configuration should be compatible with ResolverInput
      expectTypeOf(resolver).toExtend<ResolverInput>();

      expect(resolver.name).toBe("minimalCompat");
      expect(resolver.operation).toBe("query");
      expect(resolver.input).toBeUndefined();
      expect(resolver.description).toBeUndefined();
    });
  });

  describe("descriptor-based fields", () => {
    test("descriptor input fields infer correct types", () => {
      const resolver = createResolver({
        name: "descriptorInput",
        operation: "query",
        input: {
          name: { kind: "string" },
          age: { kind: "int", optional: true },
        },
        output: t.bool(),
        body: () => true,
      });
      expect(resolver.input!.name.type).toBe("string");
      expect(resolver.input!.name.metadata.required).toBe(true);
      expect(resolver.input!.age.type).toBe("integer");
      expect(resolver.input!.age.metadata.required).toBe(false);
    });

    test("descriptor output field infers correct return type", () => {
      createResolver({
        name: "descriptorOutput",
        operation: "query",
        input: {
          a: { kind: "int" },
          b: { kind: "int" },
        },
        output: { kind: "int", description: "Sum" },
        body: ({ input }) => {
          expectTypeOf(input.a).toEqualTypeOf<number>();
          return input.a + input.b;
        },
      });
    });

    test("descriptor output Record infers correct return type", () => {
      createResolver({
        name: "descriptorRecordOutput",
        operation: "mutation",
        input: {
          id: { kind: "uuid" },
        },
        output: {
          success: { kind: "bool" },
          message: { kind: "string" },
        },
        body: ({ input }) => {
          expectTypeOf(input.id).toEqualTypeOf<string>();
          return { success: true, message: "done" };
        },
      });
    });

    test("mixed fluent and descriptor fields work together", () => {
      createResolver({
        name: "mixed",
        operation: "query",
        input: {
          a: { kind: "int" },
          b: t.int(),
        },
        output: t.int(),
        body: ({ input }) => {
          expectTypeOf(input.a).toEqualTypeOf<number>();
          expectTypeOf(input.b).toEqualTypeOf<number>();
          return input.a + input.b;
        },
      });
    });

    test("enum descriptor infers literal union type", () => {
      const resolver = createResolver({
        name: "enumDesc",
        operation: "query",
        input: {
          role: { kind: "enum", values: ["ADMIN", "USER"] },
        },
        output: { kind: "string" },
        body: ({ input }) => input.role,
      });
      expect(resolver.input!.role.type).toBe("enum");
      expect(resolver.input!.role.metadata.allowedValues).toEqual([
        { value: "ADMIN", description: "" },
        { value: "USER", description: "" },
      ]);
    });

    test("object descriptor infers nested type", () => {
      const resolver = createResolver({
        name: "objectDesc",
        operation: "query",
        input: {
          user: {
            kind: "object",
            fields: {
              name: { kind: "string" },
              age: { kind: "int", optional: true },
            },
          },
        },
        output: { kind: "string" },
        body: ({ input }) => input.user.name,
      });
      expect(resolver.input!.user.type).toBe("nested");
      const nestedFields = resolver.input!.user.fields;
      expect(nestedFields.name.type).toBe("string");
      expect(nestedFields.age.type).toBe("integer");
      expect(nestedFields.age.metadata.required).toBe(false);
    });

    test("array descriptor infers array type", () => {
      createResolver({
        name: "arrayDesc",
        operation: "query",
        input: {
          tags: { kind: "string", array: true },
        },
        output: { kind: "int" },
        body: ({ input }) => {
          expectTypeOf(input.tags).toEqualTypeOf<string[]>();
          return input.tags.length;
        },
      });
    });

    test("descriptor input resolves to TailorField at runtime", () => {
      const resolver = createResolver({
        name: "runtimeCheck",
        operation: "query",
        input: {
          name: { kind: "string", description: "User name" },
          count: { kind: "int" },
        },
        output: { kind: "bool" },
        body: () => true,
      });
      expect(resolver.input).toBeDefined();
      expect(resolver.input!.name.type).toBe("string");
      expect(resolver.input!.name.metadata.description).toBe("User name");
      expect(resolver.input!.count.type).toBe("integer");
      expect(resolver.output.type).toBe("boolean");
    });

    test("descriptor with validate sets metadata correctly", () => {
      const validate: [({ value }: { value: number }) => boolean, string] = [
        ({ value }) => value >= 0,
        "Must be non-negative",
      ];
      const resolver = createResolver({
        name: "validateCheck",
        operation: "query",
        input: {
          age: {
            kind: "int",
            validate,
          },
        },
        output: { kind: "bool" },
        body: () => true,
      });
      expect(resolver.input!.age.metadata.validate).toBeDefined();
      expect(resolver.input!.age.metadata.validate!.length).toBe(1);
    });

    test("decimal descriptor outputs string type", () => {
      createResolver({
        name: "decimalDesc",
        operation: "query",
        input: {
          amount: { kind: "decimal" },
        },
        output: { kind: "decimal" },
        body: ({ input }) => {
          expectTypeOf(input.amount).toEqualTypeOf<string>();
          return input.amount;
        },
      });
    });

    test("all-descriptor resolver is compatible with ResolverInput", () => {
      const resolver = createResolver({
        name: "allDescriptor",
        operation: "query",
        input: {
          id: { kind: "uuid" },
          name: { kind: "string" },
        },
        output: {
          found: { kind: "bool" },
        },
        body: () => ({ found: true }),
      });
      expectTypeOf(resolver).toExtend<ResolverInput>();
    });
  });
});
