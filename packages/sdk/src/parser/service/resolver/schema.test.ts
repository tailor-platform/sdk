import { describe, expect, test } from "vitest";
import { ResolverAuthSchema } from "./schema";

describe("ResolverAuthSchema", () => {
  test("accepts a single policy with one condition", () => {
    expect(() =>
      ResolverAuthSchema.parse([
        { conditions: [[{ user: "_loggedIn" }, "=", true]], permit: true },
      ]),
    ).not.toThrow();
  });

  test("accepts a single policy with multiple conditions", () => {
    expect(() =>
      ResolverAuthSchema.parse([
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
      ResolverAuthSchema.parse([
        { conditions: [[{ user: "isServiceAccount" }, "=", true]], permit: true },
        { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true },
      ]),
    ).not.toThrow();
  });

  test('accepts "public"', () => {
    expect(() => ResolverAuthSchema.parse("public")).not.toThrow();
  });

  test("rejects an empty policy array", () => {
    expect(() => ResolverAuthSchema.parse([])).toThrow("auth must have at least one policy");
  });

  test("rejects a policy with an empty conditions array", () => {
    expect(() => ResolverAuthSchema.parse([{ conditions: [], permit: true }])).toThrow(
      "must have at least one condition",
    );
  });

  test("rejects a policy missing permit", () => {
    expect(() =>
      ResolverAuthSchema.parse([{ conditions: [[{ user: "_loggedIn" }, "=", true]] }]),
    ).toThrow("permit");
  });
});
