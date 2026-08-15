import * as v from "valibot";
import { describe, expect, test } from "vitest";
import { ResolverPermissionSchema, ResolverSchema } from "./schema";

function expectParseFailure<T>(
  result: v.SafeParseResult<v.GenericSchema<unknown, T>>,
): [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]] {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected schema parsing to fail");
  }
  return result.issues;
}

// Union branches wrap their own array-level checks (minLength, at-least-one-permit,
// user-operand cross-checks); a failing union collects those as nested `.issues`
// rather than surfacing them as the top-level thrown message, so rejection
// assertions search the full issue tree instead of `.toThrow()`.
function findIssueMessage(issues: readonly v.BaseIssue<unknown>[], substring: string): boolean {
  return issues.some(
    (issue) =>
      issue.message.includes(substring) ||
      ("issues" in issue &&
        Array.isArray(issue.issues) &&
        findIssueMessage(issue.issues as v.BaseIssue<unknown>[], substring)),
  );
}

function expectRejectionMessage(input: unknown, substring: string) {
  const issues = expectParseFailure(v.safeParse(ResolverPermissionSchema, input));
  expect(findIssueMessage(issues, substring)).toBe(true);
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
    const issues = expectParseFailure(
      v.safeParse(ResolverSchema, {
        ...validResolver,
        unknownOption: true,
      }),
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "strict_object",
        }),
      ]),
    );
  });
});

describe("ResolverPermissionSchema", () => {
  test("accepts a single policy with one condition", () => {
    expect(() =>
      v.parse(ResolverPermissionSchema, [
        { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
      ]),
    ).not.toThrow();
  });

  test("accepts a single policy with multiple conditions", () => {
    expect(() =>
      v.parse(ResolverPermissionSchema, [
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
      v.parse(ResolverPermissionSchema, [
        { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
        { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
      ]),
    ).not.toThrow();
  });

  test('accepts "allowAnonymous"', () => {
    expect(() => v.parse(ResolverPermissionSchema, "allowAnonymous")).not.toThrow();
  });

  test("accepts a mix of `permit: true` and `permit: false` policies", () => {
    expect(() =>
      v.parse(ResolverPermissionSchema, [
        { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
        { conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false },
      ]),
    ).not.toThrow();
  });

  test("rejects a policy array with only `permit: false` policies", () => {
    expectRejectionMessage(
      [{ conditions: [[{ user: "role" }, "=", "BANNED"]], permit: false }],
      "must include at least one `permit: true` policy",
    );
  });

  test("rejects an empty policy array", () => {
    expectRejectionMessage([], "permission must have at least one policy");
  });

  test("rejects a policy with an empty conditions array", () => {
    expectRejectionMessage([{ conditions: [], permit: true }], "must have at least one condition");
  });

  test("rejects a policy missing permit", () => {
    expectRejectionMessage([{ conditions: [[{ user: "_loggedIn" }, "=", true]] }], "permit");
  });

  test("rejects a condition with no `user` operand on either side", () => {
    expectRejectionMessage(
      [{ conditions: [["a", "=", "b"]], permit: true }],
      "must reference a `user` operand",
    );
  });

  test("rejects a condition comparing two `user` operands to each other", () => {
    expectRejectionMessage(
      [{ conditions: [[{ user: "role" }, "=", { user: "rol" }]], permit: true }],
      "must reference a `user` operand",
    );
  });

  test("rejects `_loggedIn` compared to a string", () => {
    expectRejectionMessage(
      [{ conditions: [[{ user: "_loggedIn" }, "=", "true"]], permit: true }],
      "`_loggedIn` must compare to a boolean",
    );
  });

  test("rejects `id` compared to a boolean", () => {
    expectRejectionMessage(
      [{ conditions: [[{ user: "id" }, "=", true]], permit: true }],
      "`id` must compare to a string",
    );
  });

  test("accepts an arbitrary attribute compared to either a string or a boolean", () => {
    expect(() =>
      v.parse(ResolverPermissionSchema, [
        { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
      ]),
    ).not.toThrow();
    expect(() =>
      v.parse(ResolverPermissionSchema, [
        { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
      ]),
    ).not.toThrow();
  });
});
