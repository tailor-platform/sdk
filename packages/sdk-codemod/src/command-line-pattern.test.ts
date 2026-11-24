import { describe, expect, test } from "vitest";
import { TAILOR_BINARY, tailorCommandPrefix } from "./command-line-pattern";

function matches(
  commandLine: string,
  path: readonly string[],
  last: string,
  options?: { crossLines?: boolean; valuesMayBeOmitted?: boolean },
): boolean {
  const pattern = new RegExp(`^${tailorCommandPrefix(TAILOR_BINARY, path, options)}${last}$`);
  return pattern.test(commandLine);
}

describe("tailorCommandPrefix", () => {
  test.each([
    ["tailor function test-run"],
    ["tailor-sdk function test-run"],
    ["tailor.cmd function test-run"],
    ["tailor --json function test-run"],
    ["tailor -j function test-run"],
    ["tailor --verbose --json function test-run"],
    ["tailor function --json test-run"],
    ["tailor --json function --verbose test-run"],
    ["tailor function --no-json test-run"],
    ["tailor function --noJson test-run"],
    ["tailor function --json=false test-run"],
  ])("reaches the subcommand of %s through a global flag", (commandLine) => {
    expect(matches(commandLine, ["function"], "test-run")).toBe(true);
  });

  test.each([
    ["tailor -e .env function test-run"],
    ["tailor --env-file .env function test-run"],
    ["tailor --envFile .env function test-run"],
    ["tailor --env-file=.env function test-run"],
    ["tailor --envFile=.env function test-run"],
    ["tailor --env-file-if-exists .env function test-run"],
    ["tailor --envFileIfExists=.env function test-run"],
    ["tailor -e=.env function test-run"],
    ["tailor -e.env function test-run"],
    ["tailor -je .env function test-run"],
    ["tailor -jje .env function test-run"],
    ["tailor -jj function test-run"],
    ["tailor --env-file '.env local' function test-run"],
    ['tailor --env-file ".env local" function test-run'],
    ["tailor function -e .env test-run"],
  ])("reaches the subcommand of %s through an option that takes a value", (commandLine) => {
    expect(matches(commandLine, ["function"], "test-run")).toBe(true);
  });

  test.each([
    ["tailor \\\n  function \\\n  test-run"],
    ["tailor --json \\\n  function test-run"],
    ["tailor \\\r\n  function test-run"],
  ])("crosses a shell line continuation in %j", (commandLine) => {
    expect(matches(commandLine, ["function"], "test-run")).toBe(true);
  });

  test("matches a subcommand directly under the binary when the path is empty", () => {
    expect(matches("tailor --json apply", [], "apply")).toBe(true);
    expect(matches("tailor -e .env apply", [], "apply")).toBe(true);
  });

  test.each([
    ["custom-tailor function test-run", "another binary"],
    ["other-cli function test-run", "another binary"],
    ["tailor function logs test-run", "another subcommand in the path"],
    ["tailor workspace --json function test-run", "a command that is not on the path"],
    ["tailor --profile dev function test-run", "an option that is not global"],
    ["tailor --jsonx function test-run", "a name that only starts like a global flag"],
    ["tailor -e function test-run", "a value that swallows the subcommand name"],
    ["tailor function\ntest-run", "a line break that is not a continuation"],
    ["tailor function && tailor --json test-run", "a second command"],
  ])("does not reach the subcommand of %j: %s", (commandLine) => {
    expect(matches(commandLine, ["function"], "test-run")).toBe(false);
  });

  test.each([
    ["tailor --env-file .env\\ local function test-run"],
    ["tailor --env-file=.env\\ local function test-run"],
    ["tailor -e .env\\ local function test-run"],
    ["tailor -e=.env\\ local function test-run"],
    ["tailor --env-file C:\\env\\.env function test-run"],
  ])("reads a backslash escape inside a value in %j as part of the value", (commandLine) => {
    expect(matches(commandLine, ["function"], "test-run")).toBe(true);
  });

  describe("with crossLines", () => {
    test.each([
      ["tailor\nfunction\ntest-run"],
      ["tailor --json\n  function\n  test-run"],
      ["tailor -e .env\n  function test-run"],
      ["tailor --env-file\n  .env function test-run"],
      ["tailor \\\n  function test-run"],
    ])("reaches the subcommand across the line breaks of %j", (commandLine) => {
      expect(matches(commandLine, ["function"], "test-run", { crossLines: true })).toBe(true);
    });

    test("still stops at a second command", () => {
      expect(
        matches("tailor function && tailor --json test-run", ["function"], "test-run", {
          crossLines: true,
        }),
      ).toBe(false);
    });
  });

  test.each([
    ['tailor --env-file \\".env local\\" function test-run'],
    ["tailor --env-file=\\'.env local\\' function test-run"],
    ['tailor -e \\".env local\\" function test-run'],
    ['tailor --env-file \\"a\\" --env-file \\"b c\\" function test-run'],
  ])("reads the quotes of a command written inside a quoted string in %j", (commandLine) => {
    expect(matches(commandLine, ["function"], "test-run")).toBe(true);
  });

  describe("with valuesMayBeOmitted", () => {
    test.each([
      ["function -e test-run"],
      ["function --env-file test-run"],
      ["function -je test-run"],
    ])("takes %j to have lost the value of its option", (commandLine) => {
      expect(matches(commandLine, [], "test-run", { valuesMayBeOmitted: true })).toBe(false);
      expect(
        new RegExp(
          `^${tailorCommandPrefix("function", [], { valuesMayBeOmitted: true })}test-run$`,
        ).test(commandLine),
      ).toBe(true);
    });

    test("still reads a value that is there", () => {
      const pattern = new RegExp(
        `^${tailorCommandPrefix("function", [], { valuesMayBeOmitted: true })}test-run$`,
      );

      expect(pattern.test("function -e .env test-run")).toBe(true);
    });

    test("does not skip an option that is not global", () => {
      const pattern = new RegExp(
        `^${tailorCommandPrefix("function", [], { valuesMayBeOmitted: true })}test-run$`,
      );

      expect(pattern.test("function --profile test-run")).toBe(false);
    });
  });

  test("does not let a value be omitted by default", () => {
    const pattern = new RegExp(`^${tailorCommandPrefix("function", [])}test-run$`);

    expect(pattern.test("function -e test-run")).toBe(false);
  });

  describe("on a long run of options that take a value", () => {
    const elapsedMs = (
      head: string,
      options: { valuesMayBeOmitted?: boolean },
      commandLine: string,
    ) => {
      const pattern = new RegExp(`^${tailorCommandPrefix(head, [], options)}test-run$`);
      const start = performance.now();
      pattern.test(commandLine);
      return performance.now() - start;
    };

    test.each([["-e"], ["--env-file"], ["-je"]])(
      "does not take longer for every %s that follows another when values may be omitted",
      (flag) => {
        const commandLine = `function${` ${flag}`.repeat(30)} nope`;

        expect(elapsedMs("function", { valuesMayBeOmitted: true }, commandLine)).toBeLessThan(50);
      },
    );

    test.each([["-e"], ["--env-file"]])("stays quick for %s by default", (flag) => {
      const commandLine = `function${` ${flag}`.repeat(2000)} nope`;

      expect(elapsedMs("function", {}, commandLine)).toBeLessThan(50);
    });
  });
});
