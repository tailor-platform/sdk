import { describe, expect, test } from "vitest";
import { ResolverPermissionSchema, ResolverSchema } from "./schema";
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

  test("rejects unknown options", () => {
    const error = expectParseFailure(
      ResolverSchema.safeParse({
        ...validResolver,
        unknownOption: true,
      }),
    );

    expect(error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unrecognized_keys",
        }),
      ]),
    );
  });

  describe("input operands in permission", () => {
    const field = (type: string, metadata: Record<string, unknown> = {}) => ({
      type,
      fields: {},
      metadata,
    });
    const bindTo = (key: string) => [
      { conditions: [[{ input: key }, "=", { user: "id" }]], permit: true },
    ];

    test.each(["string", "uuid", "enum"])("accepts a bound %s input field", (type) => {
      const result = ResolverSchema.safeParse({
        ...validResolver,
        input: { employeeId: field(type) },
        permission: bindTo("employeeId"),
      });
      expect(result.success).toBe(true);
    });

    test("rejects an input operand naming an undeclared input field", () => {
      const error = expectParseFailure(
        ResolverSchema.safeParse({
          ...validResolver,
          input: { employeeId: field("string") },
          permission: bindTo("employeId"),
        }),
      );
      expect(error.issues.map((issue) => issue.message)).toContain(
        "`permission` references input field `employeId`, which `input` does not declare",
      );
    });

    test("rejects an input operand when the resolver declares no input", () => {
      const error = expectParseFailure(
        ResolverSchema.safeParse({ ...validResolver, permission: bindTo("employeeId") }),
      );
      expect(error.issues.map((issue) => issue.message)).toContain(
        "`permission` references input field `employeeId`, which `input` does not declare",
      );
    });

    test.each([
      ["an integer", field("integer")],
      ["an array", field("string", { array: true })],
    ])("rejects an input operand naming %s field", (_, inputField) => {
      const error = expectParseFailure(
        ResolverSchema.safeParse({
          ...validResolver,
          input: { employeeId: inputField },
          permission: bindTo("employeeId"),
        }),
      );
      expect(error.issues.map((issue) => issue.message)).toContain(
        "`permission` compares input field `employeeId`, but only a string, uuid, or enum field that is not an array can be compared",
      );
    });
  });
});

describe("ResolverPermissionSchema", () => {
  test("accepts a single policy with one condition", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
      ]),
    ).not.toThrow();
  });

  test("accepts a single policy with multiple conditions", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        {
          conditions: [
            [{ user: "_loggedIn" }, "=", true],
            [{ user: "role" }, "=", "ADMIN"],
          ],
          permit: true,
        },
      ]),
    ).not.toThrow();
  });

  test("accepts multiple policies", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
        { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
      ]),
    ).not.toThrow();
  });

  test('accepts "allowAnonymous"', () => {
    expect(() => ResolverPermissionSchema.parse("allowAnonymous")).not.toThrow();
  });

  test("accepts a mix of `permit: true` and `permit: false` policies", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
        { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false },
      ]),
    ).not.toThrow();
  });

  test("rejects a policy array with only `permit: false` policies", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false },
      ]),
    ).toThrow("must include at least one `permit: true` policy");
  });

  test("rejects an empty policy array", () => {
    expect(() => ResolverPermissionSchema.parse([])).toThrow(
      "permission must have at least one policy",
    );
  });

  test("rejects a policy with an empty conditions array", () => {
    expect(() => ResolverPermissionSchema.parse([{ conditions: [], permit: true }])).toThrow(
      "must have at least one condition",
    );
  });

  test("rejects a policy missing permit", () => {
    expect(() =>
      ResolverPermissionSchema.parse([{ conditions: [[{ user: "_loggedIn" }, "=", true]] }]),
    ).toThrow("permit");
  });

  test("rejects a condition with no `user` operand on either side", () => {
    expect(() =>
      ResolverPermissionSchema.parse([{ conditions: [["a", "=", "b"]], permit: true }]),
    ).toThrow("must reference a `user` operand");
  });

  test("rejects a condition comparing two `user` operands to each other", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "role" }, "=", { user: "rol" }]], permit: true },
      ]),
    ).toThrow("must reference a `user` operand");
  });

  test("rejects `_loggedIn` compared to a string", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "_loggedIn" }, "=", "true"]], permit: true },
      ]),
    ).toThrow("`_loggedIn` must compare to a boolean");
  });

  test("rejects `id` compared to a boolean", () => {
    expect(() =>
      ResolverPermissionSchema.parse([{ conditions: [[{ user: "id" }, "=", true]], permit: true }]),
    ).toThrow("`id` must compare to a string");
  });

  test("accepts an input operand compared to a `user` operand on either side", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ input: "employeeId" }, "=", { user: "id" }]], permit: true },
        { conditions: [[{ user: "employeeId" }, "=", { input: "requesterId" }]], permit: true },
      ]),
    ).not.toThrow();
  });

  test.each([
    ["a string", "u1"],
    ["a boolean", true],
    ["another input operand", { input: "managerId" }],
  ])("rejects an input operand compared to %s", (_, other) => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ input: "employeeId" }, "=", other]], permit: true },
      ]),
    ).toThrow("An `input` operand must be compared to a `user` operand");
  });

  test("rejects an input operand compared with `!=`", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ input: "requesterId" }, "!=", { user: "id" }]], permit: true },
      ]),
    ).toThrow("An `input` operand can only be compared with `=`");
  });

  test("rejects `_loggedIn` compared to an input operand", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "_loggedIn" }, "=", { input: "flag" }]], permit: true },
      ]),
    ).toThrow("`_loggedIn` must compare to a boolean");
  });

  test("rejects an input operand in a `permit: false` policy", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
        { conditions: [[{ input: "employeeId" }, "=", { user: "id" }]], permit: false },
      ]),
    ).toThrow("An `input` operand can only be used in a `permit: true` policy");
  });

  test("accepts an arbitrary attribute compared to either a string or a boolean", () => {
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
      ]),
    ).not.toThrow();
    expect(() =>
      ResolverPermissionSchema.parse([
        { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
      ]),
    ).not.toThrow();
  });
});
