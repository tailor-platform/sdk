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
