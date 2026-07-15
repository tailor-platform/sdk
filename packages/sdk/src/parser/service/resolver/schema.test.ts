import { describe, expect, test } from "vitest";
import { ResolverPermissionSchema } from "./schema";

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
});
