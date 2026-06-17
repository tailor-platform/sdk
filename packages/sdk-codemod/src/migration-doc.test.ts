import { describe, expect, test } from "vitest";
import { automationLevel, renderMigrationDoc } from "./migration-doc";
import type { CodemodPackage } from "./types";

function makeCodemod(overrides: Partial<CodemodPackage>): CodemodPackage {
  return {
    id: "v2/example",
    name: "Example",
    description: "Example change.",
    since: "1.0.0",
    until: "2.0.0",
    scriptPath: "v2/example/scripts/transform.js",
    ...overrides,
  };
}

describe("automationLevel", () => {
  test("transform with no residual signals is Automatic", () => {
    expect(automationLevel(makeCodemod({}))).toBe("Automatic");
  });

  test("transform with legacyPatterns/suspiciousPatterns/prompt is Partially automatic", () => {
    expect(automationLevel(makeCodemod({ legacyPatterns: ["x"] }))).toBe("Partially automatic");
    expect(automationLevel(makeCodemod({ suspiciousPatterns: ["x"], prompt: "do it" }))).toBe(
      "Partially automatic",
    );
  });

  test("no scriptPath is Manual", () => {
    expect(automationLevel(makeCodemod({ scriptPath: undefined as unknown as string }))).toBe(
      "Manual",
    );
  });
});

describe("renderMigrationDoc", () => {
  test("renders heading, automation level, examples, and prompt", () => {
    const doc = renderMigrationDoc([
      makeCodemod({
        name: "executeScript arg",
        description: "Pass a value, not a string.",
        suspiciousPatterns: ["executeScript"],
        prompt: "Unwrap JSON.stringify in the arg.",
        examples: [{ before: "arg: JSON.stringify(x)", after: "arg: x" }],
      }),
    ]);

    expect(doc).toContain("# Migrating to v2");
    expect(doc).toContain("## executeScript arg");
    expect(doc).toContain("**Migration:** Partially automatic");
    expect(doc).toContain("Before:\n\n```ts\narg: JSON.stringify(x)\n```");
    expect(doc).toContain("After:\n\n```ts\narg: x\n```");
    expect(doc).toContain("<summary>Prompt for an AI agent");
    expect(doc).toContain("```text\nUnwrap JSON.stringify in the arg.\n```");
  });

  test("omits the prompt block for Automatic entries", () => {
    const doc = renderMigrationDoc([makeCodemod({ name: "Auto", description: "Auto change." })]);
    expect(doc).toContain("**Migration:** Automatic");
    expect(doc).not.toContain("How to finish");
  });
});
