import { describe, expect, test } from "vitest";
import { TAILOR_BINARY, tailorCommandPrefix } from "./command-line-pattern";

function matches(commandLine: string, path: readonly string[], last: string): boolean {
  const pattern = new RegExp(`^${tailorCommandPrefix(TAILOR_BINARY, path)}${last}$`);
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
});
