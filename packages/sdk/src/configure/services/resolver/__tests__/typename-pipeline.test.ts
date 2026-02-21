import { describe, it, expect } from "vitest";
import { db } from "@/configure/services/tailordb";
import { t } from "@/configure/types/type";
import { ResolverSchema } from "@/parser/service/resolver/schema";
import { createResolver, toResolverOutput } from "../resolver";

describe("typeName preservation through pipeline", () => {
  it("toResolverOutput preserves typeName in metadata", () => {
    const testType = db.type("TestProfile", "Test", {
      name: db.string(),
      age: db.int({ optional: true }),
    });

    const output = toResolverOutput(testType);
    expect(output.type).toBe("nested");
    expect(output.metadata.typeName).toBe("TestProfile");
    expect(output._metadata.typeName).toBe("TestProfile");
  });

  it("typeName survives Zod ResolverSchema parsing", () => {
    const testType = db.type("TestProfile", "Test", {
      name: db.string(),
      age: db.int({ optional: true }),
    });

    const resolver = createResolver({
      name: "testResolver",
      operation: "query",
      input: {
        name: t.string(),
        data: t.object({ x: t.int() }).typeName("CustomInput"),
      },
      body: () => ({ id: crypto.randomUUID(), name: "test", age: 1 }),
      output: toResolverOutput(testType),
    });

    // Verify before parsing
    expect(resolver.output.metadata.typeName).toBe("TestProfile");

    // Parse through Zod (same as what the apply command does)
    const parsed = ResolverSchema.safeParse(resolver);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      // Verify output typeName survives
      expect(parsed.data.output.metadata.typeName).toBe("TestProfile");

      // Verify input typeName survives
      expect(parsed.data.input?.data?.metadata?.typeName).toBe("CustomInput");
    }
  });
});
