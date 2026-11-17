import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

const fixture = [
  'import { CLIError, internalError } from "#/cli/shared/errors";',
  "export function userFailure(): never {",
  '  throw CLIError({ code: "EXAMPLE_FAILURE", message: "example" });',
  "}",
  "export function invariant(): never {",
  '  throw internalError("invariant violated");',
  "}",
  "export function plain(): never {",
  '  throw new Error("plain");',
  "}",
  'export const timeout = new Promise((_, reject) => reject(new Error("timeout")));',
  'export const generated = `throw new Error("inside generated code")`;',
  'export const called = Error("call");',
  "export class VersionError extends Error {}",
  "",
].join("\n");

function lint(level: "error" | "off") {
  return lintWithLocalRule({
    rule: "no-plain-error",
    level,
    fileName: "command.ts",
    source: fixture,
  });
}

describe("local/no-plain-error", () => {
  test("flags every Error construction outside generated-code strings", () => {
    expect(lint("error")).toEqual([
      { rule: "local(no-plain-error)", line: 9 },
      { rule: "local(no-plain-error)", line: 11 },
      { rule: "local(no-plain-error)", line: 13 },
      { rule: "local(no-plain-error)", line: 14 },
    ]);
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
