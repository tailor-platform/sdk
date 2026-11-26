import { describe, expect, test } from "vitest";
import {
  GLOBAL_BOOLEAN_FLAGS,
  GLOBAL_BOOLEAN_OPTIONS,
  GLOBAL_VALUE_FLAGS,
  GLOBAL_VALUE_OPTIONS,
} from "./global-options";

describe("GLOBAL_VALUE_FLAGS", () => {
  test("spells an option that takes a value by its kebab-case name, its camelCase name, and its alias", () => {
    expect(GLOBAL_VALUE_FLAGS).toEqual(expect.arrayContaining(["--env-file", "--envFile", "-e"]));
  });

  test("spells an option without an alias only by its two long names", () => {
    expect(GLOBAL_VALUE_FLAGS).toEqual(
      expect.arrayContaining(["--env-file-if-exists", "--envFileIfExists"]),
    );
    expect(
      GLOBAL_VALUE_FLAGS.filter((flag) => flag.includes("IfExists") || flag.includes("if-exists")),
    ).toHaveLength(2);
  });

  test("does not list a negated spelling for an option that takes a value", () => {
    expect(GLOBAL_VALUE_FLAGS.some((flag) => flag.startsWith("--no"))).toBe(false);
  });
});

describe("GLOBAL_BOOLEAN_FLAGS", () => {
  test("spells a flag by its name, its alias, and both negated forms", () => {
    expect(GLOBAL_BOOLEAN_FLAGS).toEqual(
      expect.arrayContaining(["--json", "-j", "--no-json", "--noJson"]),
    );
  });

  test("spells a flag without an alias by its name and both negated forms", () => {
    expect(GLOBAL_BOOLEAN_FLAGS).toEqual(
      expect.arrayContaining(["--verbose", "--no-verbose", "--noVerbose"]),
    );
  });

  test("lists no option that takes a value", () => {
    expect(GLOBAL_BOOLEAN_FLAGS.some((flag) => flag.includes("env"))).toBe(false);
  });
});

describe("global option lists", () => {
  test("give every alias a single character, so that a command line can join them as in -je", () => {
    const aliases = [...GLOBAL_VALUE_OPTIONS, ...GLOBAL_BOOLEAN_OPTIONS].flatMap(
      (option) => option.alias ?? [],
    );

    expect(aliases.filter((alias) => alias.length !== 1)).toEqual([]);
  });
});
