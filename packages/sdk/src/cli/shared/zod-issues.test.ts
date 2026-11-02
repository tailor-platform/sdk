import { describe, expect, test } from "vitest";
import { z } from "zod";
import { flattenZodIssues, formatIssueList } from "./zod-issues";

function issuesOf(schema: z.ZodType, value: unknown, prefix?: Array<string | number>) {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error("expected the value to fail validation");
  }
  return flattenZodIssues(result.error.issues, prefix);
}

describe("flattenZodIssues", () => {
  test("reports the issues of the branch the input came closest to matching", () => {
    const schema = z.union([
      z.strictObject({ kind: z.literal("a"), a: z.string() }),
      z.strictObject({ kind: z.literal("b"), b: z.strictObject({ count: z.number() }) }),
    ]);

    expect(issuesOf(schema, { kind: "b", b: { count: "1" } })).toEqual([
      { path: ["b", "count"], message: "Invalid input: expected number, received string" },
    ]);
  });

  test("reports an issue every branch shares once, next to the closest branch's own", () => {
    const schema = z.union([
      z.strictObject({ name: z.string(), a: z.string() }),
      z.strictObject({ name: z.string(), b: z.strictObject({ count: z.number() }) }),
    ]);

    expect(issuesOf(schema, { name: 1, b: { count: "1" } })).toEqual([
      { path: ["name"], message: "Invalid input: expected string, received number" },
      { path: ["b", "count"], message: "Invalid input: expected number, received string" },
    ]);
  });

  test("reports only a shared issue when one branch has nothing else wrong", () => {
    const schema = z.union([
      z.strictObject({ name: z.string(), b: z.unknown() }),
      z.strictObject({ name: z.string(), b: z.strictObject({ count: z.number() }) }),
    ]);

    expect(issuesOf(schema, { name: 1, b: { count: "1" } })).toEqual([
      { path: ["name"], message: "Invalid input: expected string, received number" },
    ]);
  });

  test("reports only the shared issues when no branch has anything else wrong", () => {
    const schema = z.union([
      z.strictObject({ name: z.string(), a: z.string().optional() }),
      z.strictObject({ name: z.string(), b: z.number().optional() }),
    ]);

    expect(issuesOf(schema, { name: 1 })).toEqual([
      { path: ["name"], message: "Invalid input: expected string, received number" },
    ]);
  });

  test("resolves a union nested in the closest branch at its absolute path", () => {
    const schema = z.strictObject({
      outer: z.union([z.strictObject({ inner: z.union([z.string(), z.number()]) }), z.string()]),
    });

    expect(issuesOf(schema, { outer: { inner: true } })).toEqual([
      { path: ["outer", "inner"], message: "Invalid input: expected string | number" },
    ]);
  });

  test("names the accepted values of a leaf union no branch got further into", () => {
    const schema = z.strictObject({
      operation: z.union([z.literal("query"), z.literal("mutation")]),
    });

    expect(issuesOf(schema, { operation: "bogus" })).toEqual([
      { path: ["operation"], message: 'Invalid input: expected "query" | "mutation"' },
    ]);
  });

  test("keeps a union's own message when no branch got further", () => {
    const schema = z.union([z.literal(false), z.literal("deploy")], {
      message: "must be false or deploy",
    });

    expect(issuesOf(schema, "yes")).toEqual([{ path: [], message: "must be false or deploy" }]);
  });

  test("reports the union itself when tied branches fail on different fields", () => {
    const schema = z.union([z.strictObject({ a: z.string() }), z.strictObject({ b: z.string() })]);

    expect(issuesOf(schema, {})).toEqual([{ path: [], message: "Invalid input" }]);
  });

  test("reports a discriminated union with no matching option at its discriminator", () => {
    const schema = z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("a") }),
      z.strictObject({ kind: z.literal("b") }),
    ]);

    expect(issuesOf(schema, { kind: "c" })).toEqual([
      { path: ["kind"], message: "Invalid discriminator value. Expected 'a' | 'b'" },
    ]);
  });

  test("reports an invalid record key with the key schema's message at the key", () => {
    const schema = z.record(z.string().regex(/^[a-z]+$/, "must be lowercase"), z.number());

    expect(issuesOf(schema, { ok: 1, Bad: 2 }, ["clients"])).toEqual([
      { path: ["clients", "Bad"], message: "must be lowercase" },
    ]);
  });

  test("prepends the prefix to every path, including those inside a union", () => {
    const schema = z.strictObject({
      operation: z.union([z.literal("query"), z.literal("mutation")]),
      name: z.string(),
    });

    expect(issuesOf(schema, { operation: "bogus", name: 1 }, ["resolvers", 0])).toEqual([
      {
        path: ["resolvers", 0, "operation"],
        message: 'Invalid input: expected "query" | "mutation"',
      },
      {
        path: ["resolvers", 0, "name"],
        message: "Invalid input: expected string, received number",
      },
    ]);
  });
});

describe("formatIssueList", () => {
  test("renders one indented line per issue, naming an empty path as the root", () => {
    expect(
      formatIssueList([
        { path: [], message: "Unrecognized key" },
        { path: ["a", 0, "b"], message: "Required" },
      ]),
    ).toBe("  - (root): Unrecognized key\n  - a.0.b: Required");
  });
});
