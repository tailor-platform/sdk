import { describe, expect, test } from "vitest";
import { ResolverSchema } from "./schema";
import type { ZodError } from "zod";

function expectParseFailure<T>(
  result: { success: true; data: T } | { success: false; error: ZodError },
): ZodError {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected schema parsing to fail");
  }
  return result.error;
}

describe("ResolverSchema", () => {
  const validResolver = {
    operation: "query",
    name: "getUser",
    body: () => {},
    output: {
      type: "string",
      fields: {},
      metadata: {},
    },
  };

  test("rejects legacy authInvoker option", () => {
    const error = expectParseFailure(
      ResolverSchema.safeParse({
        ...validResolver,
        authInvoker: "admin",
      }),
    );

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["authInvoker"],
        }),
      ]),
    );
  });
});
