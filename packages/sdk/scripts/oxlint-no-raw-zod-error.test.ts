import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

const fixture = [
  'import { z } from "zod";',
  "const UserSchema = z.object({ name: z.string() });",
  "export const direct = (value: unknown) => UserSchema.parse(value);",
  "export const chained = (value: unknown) => UserSchema.optional().parse(value);",
  "export const inline = (value: unknown) => z.string().parse(value);",
  "export const parsedAsync = (value: unknown) => UserSchema.parseAsync(value);",
  "export function rethrow(value: unknown) {",
  "  const result = UserSchema.safeParse(value);",
  "  if (!result.success) throw result.error;",
  "  return result.data;",
  "}",
  "export async function rethrowAsync(value: unknown) {",
  "  const result = await UserSchema.safeParseAsync(value);",
  "  if (!result.success) throw result.error;",
  "  return result.data;",
  "}",
  "export function fromClosure(value: unknown) {",
  "  const result = UserSchema.safeParse(value);",
  "  return () => {",
  "    if (!result.success) throw result.error;",
  "  };",
  "}",
  "export function shadowed(value: unknown) {",
  "  const result = UserSchema.safeParse(value);",
  "  if (result.success) return () => result.data;",
  "  return () => {",
  '    const result = { error: new Error("other") };',
  "    throw result.error;",
  "  };",
  "}",
  "export function otherResult(run: () => { error: Error }) {",
  "  const result = run();",
  "  throw result.error;",
  "}",
  'export const json = JSON.parse("{}");',
  'export const parts = path.parse("/a/b.ts");',
  "",
].join("\n");

function lint(level: "error" | "off") {
  return lintWithLocalRule({
    rule: "no-raw-zod-error",
    level,
    fileName: "loader.ts",
    source: fixture,
  });
}

describe("local/no-raw-zod-error", () => {
  test("flags throwing Zod parses and rethrown safeParse errors only", () => {
    expect(lint("error")).toEqual([
      { rule: "local(no-raw-zod-error)", line: 3 },
      { rule: "local(no-raw-zod-error)", line: 4 },
      { rule: "local(no-raw-zod-error)", line: 5 },
      { rule: "local(no-raw-zod-error)", line: 6 },
      { rule: "local(no-raw-zod-error)", line: 9 },
      { rule: "local(no-raw-zod-error)", line: 14 },
      { rule: "local(no-raw-zod-error)", line: 20 },
    ]);
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
