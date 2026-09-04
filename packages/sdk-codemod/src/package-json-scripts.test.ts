import { describe, expect, test } from "vitest";
import { transformPackageScripts } from "./package-json-scripts";

const renameOldCommand = (script: string): string => script.replace("old-command", "new-command");

describe("transformPackageScripts", () => {
  test("returns null for malformed JSON", () => {
    expect(transformPackageScripts('{"scripts":{"test":"old-command"}', renameOldCommand)).toBe(
      null,
    );
  });

  test.each([
    { name: "undefined", scripts: undefined },
    { name: "null", scripts: null },
    { name: "string", scripts: "old-command" },
    { name: "array", scripts: [] },
    { name: "number", scripts: 1 },
  ])("returns null for a non-object scripts value: $name", ({ scripts }) => {
    expect(transformPackageScripts(JSON.stringify({ scripts }), renameOldCommand)).toBe(null);
  });

  test("skips non-string script values", () => {
    const source = JSON.stringify({
      scripts: {
        build: "old-command",
        skipped: 1,
      },
    });

    expect(transformPackageScripts(source, renameOldCommand)).toBe(
      JSON.stringify(
        {
          scripts: {
            build: "new-command",
            skipped: 1,
          },
        },
        null,
        2,
      ),
    );
  });

  test.each([
    ["the original string", (script: string) => script],
    ["null", () => null],
  ])("returns null when the callback returns %s", (_name, transformScript) => {
    const source = JSON.stringify({ scripts: { build: "old-command" } });
    expect(transformPackageScripts(source, transformScript)).toBe(null);
  });

  test.each([
    ["without", ""],
    ["with", "\n"],
  ])("preserves a %s trailing newline", (_name, trailing) => {
    const source = `${JSON.stringify({ scripts: { build: "old-command" } })}${trailing}`;
    const expected = `${JSON.stringify({ scripts: { build: "new-command" } }, null, 2)}${trailing}`;

    expect(transformPackageScripts(source, renameOldCommand)).toBe(expected);
  });
});
