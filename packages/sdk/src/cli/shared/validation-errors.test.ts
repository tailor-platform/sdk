import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { getErrorDiagnostics, withErrorDiagnostics } from "./error-diagnostics";
import { CLIError, isCLIError, typeOnlyImportHint } from "./errors";
import { prefixUserModuleFile } from "./validation-errors";

describe("prefixUserModuleFile", () => {
  const file = path.join(process.cwd(), "tailordb/item.ts");

  test("prefixes the file to the message, keeping the original as cause and its stack", () => {
    const error = new Error("item table is broken");

    expect(prefixUserModuleFile(error, file)).toMatchObject({
      name: "Error",
      message: "tailordb/item.ts: item table is broken",
      cause: error,
      stack: error.stack,
    });
  });

  test("keeps the native error class", () => {
    const prefixed = prefixUserModuleFile(new TypeError("x is undefined"), file);

    expect(prefixed).toBeInstanceOf(TypeError);
    expect(prefixed).toMatchObject({ message: "tailordb/item.ts: x is undefined" });
  });

  test("keeps the import type hint of a failed import", () => {
    const error = new SyntaxError(
      "The requested module './types.ts' does not provide an export named 'Item'",
    );

    const hint = typeOnlyImportHint(prefixUserModuleFile(error, file));

    expect(hint).toContain("If 'Item' is a type");
  });

  test("keeps the name of another error class", () => {
    class ItemError extends Error {
      override name = "ItemError";
    }

    expect(prefixUserModuleFile(new ItemError("bad"), file)).toMatchObject({
      name: "ItemError",
      message: "tailordb/item.ts: bad",
    });
  });

  test("keeps the fields of a CLI error", () => {
    const error = CLIError({
      code: "UNRESOLVED_IMPORT",
      message: 'Could not resolve "lib".',
      details: "details",
      suggestion: "suggestion",
      command: "generate",
      next: { command: "tailor", args: ["generate"] },
      context: { specifier: "lib" },
    });

    const prefixed = prefixUserModuleFile(error, file);

    if (!isCLIError(prefixed)) throw new Error("expected a CLI error");
    expect(prefixed).toMatchObject({
      code: "UNRESOLVED_IMPORT",
      message: 'tailordb/item.ts: Could not resolve "lib".',
      details: "details",
      suggestion: "suggestion",
      command: "generate",
      next: { command: "tailor", args: ["generate"] },
      context: { specifier: "lib" },
      cause: error,
    });
    expect(prefixed.format()).toContain('tailordb/item.ts: Could not resolve "lib".');
  });

  test("keeps the diagnostics of the original error", () => {
    const error = withErrorDiagnostics(new Error("bad"), {
      code: "PLUGIN_FAILED",
      suggestion: "Fix the plugin.",
    });

    const prefixed = prefixUserModuleFile(error, file);

    if (!(prefixed instanceof Error)) throw new Error("expected an Error");
    expect(getErrorDiagnostics(prefixed)).toEqual({
      code: "PLUGIN_FAILED",
      suggestion: "Fix the plugin.",
    });
  });

  test.each([
    ["absolute", `validate in ${path.join(process.cwd(), "tailordb/item.ts")} must be synchronous`],
    ["relative", "Invalid syntax in tailordb/item.ts:3: Expression expected"],
  ])("returns an error whose message names the file by its %s path as-is", (_, message) => {
    const error = new Error(message);

    expect(prefixUserModuleFile(error, file)).toBe(error);
  });

  test("returns an error located at another source as-is", () => {
    const error = withErrorDiagnostics(new Error("bad"), {
      location: { file: path.join(process.cwd(), "helpers.ts") },
    });

    expect(prefixUserModuleFile(error, file)).toBe(error);
  });

  test("returns a thrown non-error value as-is", () => {
    expect(prefixUserModuleFile("broken", file)).toBe("broken");
  });
});
