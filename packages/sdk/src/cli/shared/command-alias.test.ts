import { describe, expect, test } from "vitest";
import { invokedViaSubcommand } from "./command-alias";

const invoked = (...argv: string[]) =>
  invokedViaSubcommand(["node", "tailor", ...argv], "function", "test-run");

describe("invokedViaSubcommand", () => {
  test.each([
    [["function", "test-run"]],
    [["function", "--verbose", "test-run"]],
    [["function", "-j", "test-run"]],
    [["function", "--env-file", ".env", "test-run"]],
    [["function", "-e", ".env", "test-run"]],
    [["function", "--env-file=.env", "test-run"]],
    [["--json", "function", "test-run"]],
    [["--env-file", "function", "function", "test-run"]],
  ])("is true when the subcommand is invoked as %j", (argv) => {
    expect(invoked(...argv)).toBe(true);
  });

  test.each([
    [["function", "run"]],
    [["function", "--env-file", "test-run"]],
    [["function", "-e", "test-run"]],
    [["function", "--", "test-run"]],
    [["workflow", "test-run"]],
  ])("is false when %j does not name the subcommand", (argv) => {
    expect(invoked(...argv)).toBe(false);
  });

  test("matches the parent and subcommand names it is given", () => {
    expect(
      invokedViaSubcommand(["node", "tailor", "function", "script"], "function", "script"),
    ).toBe(true);
    expect(
      invokedViaSubcommand(["node", "tailor", "function", "script"], "function", "test-run"),
    ).toBe(false);
  });
});
