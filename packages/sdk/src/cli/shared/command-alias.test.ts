import { describe, expect, test } from "vitest";
import { invokedViaAlias } from "./command-alias";

describe("invokedViaAlias", () => {
  const detect = (...argv: string[]): boolean =>
    invokedViaAlias({ parent: "setup", alias: "renovate", argv: ["node", "tailor", ...argv] });

  test("detects the alias directly after the parent", () => {
    expect(detect("setup", "renovate")).toBe(true);
  });

  test("detects the alias after a boolean global option", () => {
    expect(detect("setup", "--json", "renovate")).toBe(true);
    expect(detect("setup", "--verbose", "renovate")).toBe(true);
    expect(detect("setup", "-j", "renovate")).toBe(true);
  });

  test("detects the alias after a value-taking global option", () => {
    expect(detect("setup", "--env-file", ".env", "renovate")).toBe(true);
    expect(detect("setup", "-e", ".env", "renovate")).toBe(true);
    expect(detect("setup", "--env-file=.env", "renovate")).toBe(true);
  });

  test("detects the alias after global options preceding the parent", () => {
    expect(detect("--json", "setup", "renovate")).toBe(true);
    expect(detect("--env-file", ".env", "setup", "renovate")).toBe(true);
  });

  test("does not treat a global option value as the subcommand name", () => {
    expect(detect("setup", "--env-file", "renovate")).toBe(false);
    expect(detect("setup", "-e", "renovate")).toBe(false);
  });

  test("skips values of camelCase global options, which politty also accepts", () => {
    expect(detect("setup", "--envFileIfExists", ".env", "renovate")).toBe(true);
    expect(detect("setup", "--envFileIfExists", "renovate")).toBe(false);
    expect(detect("setup", "--envFileIfExists", "renovate", "deps")).toBe(false);
  });

  test("does not treat a global option value as the parent name", () => {
    expect(detect("--env-file", "setup", "setup", "renovate")).toBe(true);
    expect(detect("-e", "setup", "setup", "renovate")).toBe(true);
    expect(detect("--env-file", "setup", "renovate")).toBe(false);
  });

  test("rejects the canonical name and unrelated subcommands", () => {
    expect(detect("setup", "deps")).toBe(false);
    expect(detect("setup", "--json", "check")).toBe(false);
  });

  test("rejects the alias when it does not follow the parent", () => {
    expect(detect("renovate")).toBe(false);
    expect(detect("setup", "deps", "renovate")).toBe(false);
    expect(detect("setup", "--", "renovate")).toBe(false);
  });
});
