import { describe, expect, it } from "vitest";
import { createResolver } from "@/configure/services/resolver/resolver";
import { t } from "@/configure/types/type";
import { ResolverSchema } from "./schema";

describe("ResolverSchema accepts descriptor-built resolvers", () => {
  it("parses a resolver built entirely from object-literal descriptors", () => {
    const resolver = createResolver({
      name: "add",
      operation: "query",
      input: {
        a: { kind: "int", description: "First number" },
        b: { kind: "int" },
      },
      output: { kind: "int", description: "Sum" },
      body: ({ input }) => input.a + input.b,
    });

    const parsed = ResolverSchema.safeParse(resolver);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.name).toBe("add");
    expect(parsed.data.operation).toBe("query");
    expect(parsed.data.input?.a.type).toBe("integer");
    expect(parsed.data.input?.a.metadata.description).toBe("First number");
    expect(parsed.data.input?.b.type).toBe("integer");
    expect(parsed.data.output.type).toBe("integer");
    expect(parsed.data.output.metadata.description).toBe("Sum");
  });

  it("parses a resolver with mixed fluent and descriptor input fields", () => {
    const resolver = createResolver({
      name: "mixedFields",
      operation: "query",
      input: {
        descriptorField: { kind: "string" },
        fluentField: t.int(),
      },
      output: { kind: "bool" },
      body: () => true,
    });

    const parsed = ResolverSchema.safeParse(resolver);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.input?.descriptorField.type).toBe("string");
    expect(parsed.data.input?.fluentField.type).toBe("integer");
  });

  it("parses a resolver whose output is a Record of descriptors (wrapped as nested)", () => {
    const resolver = createResolver({
      name: "recordOutput",
      operation: "mutation",
      input: { id: { kind: "uuid" } },
      output: {
        success: { kind: "bool" },
        message: { kind: "string", optional: true },
      },
      body: () => ({ success: true, message: null }),
    });

    const parsed = ResolverSchema.safeParse(resolver);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.output.type).toBe("nested");
    expect(parsed.data.output.fields.success.type).toBe("boolean");
    expect(parsed.data.output.fields.message.type).toBe("string");
    expect(parsed.data.output.fields.message.metadata.required).toBe(false);
  });

  it("parses a resolver with enum and object descriptors carrying typeName", () => {
    const resolver = createResolver({
      name: "richDescriptors",
      operation: "query",
      input: {
        role: {
          kind: "enum",
          values: ["ADMIN", "USER"],
          typeName: "RoleEnum",
        },
        profile: {
          kind: "object",
          typeName: "ProfilePayload",
          fields: {
            displayName: { kind: "string" },
            age: { kind: "int", optional: true },
          },
        },
      },
      output: { kind: "bool" },
      body: () => true,
    });

    const parsed = ResolverSchema.safeParse(resolver);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.input?.role.type).toBe("enum");
    expect(parsed.data.input?.role.metadata.typeName).toBe("RoleEnum");
    expect(parsed.data.input?.role.metadata.allowedValues).toEqual([
      { value: "ADMIN", description: "" },
      { value: "USER", description: "" },
    ]);
    expect(parsed.data.input?.profile.type).toBe("nested");
    expect(parsed.data.input?.profile.metadata.typeName).toBe("ProfilePayload");
    expect(parsed.data.input?.profile.fields.displayName.type).toBe("string");
  });

  it("parses an array descriptor and preserves the array flag", () => {
    const resolver = createResolver({
      name: "arrayInput",
      operation: "query",
      input: {
        tags: { kind: "string", array: true },
      },
      output: { kind: "int" },
      body: ({ input }) => input.tags.length,
    });

    const parsed = ResolverSchema.safeParse(resolver);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.input?.tags.type).toBe("string");
    expect(parsed.data.input?.tags.metadata.array).toBe(true);
  });
});
